# Post-event audit: the October 2026 flood through Potomac Pulse

Date: 2026-11-10. Event: Little Falls 1,330 cfs (2026-10-09) to a 24,300 cfs crest
(2026-10-14 14:45Z), recession to about 6,000 cfs by 2026-10-19. Point of Rocks crested at 26,300.
Code audited: commit 573d8eb (v37.21); the estimator is identical to the v37.20 that ran during
the flood. All times UTC. Error = estimate minus actual; negative means the app under-read.

This is one event. Every number below is an observation about this flood, not an estimate of
general skill.

## How this was done

1. An independent Opus auditor critiqued the plan (`PLAN.md`) before any analysis and issued
   binding amendments (`PLAN_AUDIT.txt`). The most important: do not feed the replay "the latest
   USGS value at the tick" (that leaks readings the cron did not yet have), and keep "what the app
   scored" separate from "what the river did".
2. The real server `makeGFPrediction` was replayed for all 313 hourly ticks 10-08 to 10-21, with
   per-gauge reporting lags fitted to the logged predictions (`REPLAY_NOTES.md`,
   `REPLAY_REPORT.txt`).
3. Six analysts each traced one aspect. Six separate Opus verifiers then tried to refute every
   finding by recomputing in Python from the raw USGS file, with live USGS spot checks.
   Result: 61 findings, 23 confirmed, 38 corrected, 0 refuted. Only corrected wording is used here.
4. A completeness critic listed what nobody traced, investigated the three largest gaps itself,
   and ranked the results (`CRITIC.txt`).

Marks used below: **[V]** independently verified; **[S]** single source (critic only, mechanism read
from code, effect simulated).

## What limits this audit

- **The rising limb is the weakest part.** No raw estimate was logged between 10-11T12 and
  10-14T06. The replay reproduces all 20 logged raw values within 1 percent, but that fit is
  in-sample, and one hard constraint on the rise fails (a bin implies raw 20,743 at 10-12T15; the
  replay gives 16,401). Rising-limb raw magnitudes are unverified and may be biased low.
- **Only the server's estimate was replayed.** What a browser computed and showed is not observable.
- **Bins before the flood were never captured.** Corrected values before 10-15T16 are a bracket.
- **Forecast rows from the event are gone**, and past NWS forecasts cannot be retrieved.
- **Process breach:** the forecast analyst made read-only requests to api.water.noaa.gov, which
  was outside the allowed list. Nothing was written anywhere.

## What went well [V]

- The cron ran every hourly tick through the event.
- Measured tributaries were the load-bearing component: dropping them raises error by 22 to 32
  points on the onset and rise.
- The Little Falls stage rating was accurate (mean absolute error 0.02 ft, crest within 0.06 ft).
- Travel time on the recession fit within about 1.4 hours between 12,000 and 20,000 cfs.
- The learning arithmetic reproduces exactly from the logs.
- Before the flood the display was reasonably honest: band coverage 69 of 72 ticks.

## What went wrong, ranked

### 1. The recession was under-read for about three days and every safety layer missed it [V]
Two causes stacked. The Point of Rocks delta correction pushed the raw estimate low (raw bias
−4.3 percent; −0.6 percent without it). On top, the outlier check froze a wrong-signed bin
(6,000–12,000 falling, +401 cfs) that kept subtracting: corrected error 9.2 percent against raw
5.6 percent, and the correction helped on 0 of 12 rows. The 90 percent band missed 14 consecutive
validations. The residual banner never fired (worst −13.8 percent against a −15 latch). The
headline accuracy barely moved because 16 of 24 validations in that stretch were dropped.
**Status: the lockout is fixed by v39.0. The delta correction's harm on recessions is not.**

### 2. One pending prediction at a time left the onset almost unscored [V]
From 10-11T13 to 10-12T14, 26 hourly ticks, exactly one prediction was stored and scored. On the
rise there were 66 hourly predictions and 7 validations, with gaps of 13 to 16 hours while the
river rose by thousands of cfs. The first flood observation entered learning about 23 hours after
Little Falls passed 3,000 cfs. Scoring every tick would have latched the residual banner only
about 2.5 hours earlier, so the cost is mainly to learning, not to the banner.
The multi-pending design was rejected in June on correction-quality grounds, with a note to reopen
only for responsiveness. This is that evidence.

### 3. On a rising river the travel-time lookup reaches back to base flow [V for the mechanism]
The estimator's Point of Rocks to Little Falls travel was 48 to 61 hours on the early rise,
against roughly 13 hours observed, because the multiplier is taken from the lagged low flow. The
iteration failed to converge on 22 of 54 rising ticks. The delta correction then scales the
tributaries as well. The All Gauges tab showed 16 hours for the same trip at the same moment the
estimator used 57. Magnitudes of the resulting raw error are unverified (see limits).

### 4. On the rise, the number shown was the 120 percent ceiling, not the model [V]
All 8 scored predictions created 10-12T02 to 10-14T09 equal exactly 1.2 times the Little Falls
reading the cron held, which was up to 70 minutes old. The well-known "+15, 0, +15, 0" pattern is
that cap meeting a swinging validation horizon, not the model oscillating. The cap is fixed at
creation and scored 13 hours later: the −21.6 percent miss is a capped value. The cap helped on
the rise and peak (it hid a raw over-read of 18 to 37 percent) and flipped the sign of the error
at the onset. The interface never says the cap is active. Rows masked by the cap still trained
the bins, which is how 12,000–25,000 rising reached +3,762 cfs.

**Correction, 2026-11-10.** The capped rows did train the 12,000 to 25,000 rising bin, but the cap
did not cause the value. Bins learn the raw residual (rawCFS minus actual). The learning code never
reads `ceilingApplied`. The same residuals would have been learned with no cap at all. So "stop
capped rows from training bins" was aimed at the wrong cause. Evidence:
`analysis/cap-mechanism-map-2026-11-10.md`. The visible half of this problem (the page never says the
cap is active) was fixed in v39.3 (A4a). The learning half (A4b) is left open as an owner decision.

### 5. The offline cache can serve old river data labelled "Updated just now" [S]
The service worker returns the cached USGS response first and refreshes in the background; the
staleness label is driven by fetch time, not reading time. A returning visitor can see data up to
6 hours old labelled fresh for up to 15 minutes, and is one 15-minute cycle behind after that.
Simulated effect of a 6-hour-stale view: rise error 11.4 to 19.0 percent, peak 3.9 to 14.4. The
in-browser check of this behaviour has been listed as pending since June (TODO #19). How many
people saw stale data is not observable.

### 6. The "truth" includes a creek that joins below Great Falls [S]
Difficult Run enters between Great Falls and Little Falls. The app already fetches it for the
Creeks tab, but validation scores Great Falls against Little Falls with that inflow included. It
peaked at 1,620 cfs on 10-11 and accounts for roughly 65 to 100 percent of the onset residual that
earlier reviews called ungauged local runoff, and about 12 percent of onset truth. Scoring against
Little Falls minus Difficult Run moves onset bias from −31 to −22 percent. It contaminates
learning in every local storm.

### 7. Uncertainty displays carried almost no information [V, labels reconstructed]
- The 90 percent band held the actual on 20 of 41 logged validations (49 percent). It comes from a
  fixed backtest table and does not respond to anything learned since.
- Median absolute error by displayed confidence: High 9.4, Medium 9.0, Low 9.0 percent.
- "Low" was showing on 50 of 72 calm pre-event ticks at a median error of 7 percent, so the label
  was already devalued when the flood arrived.
- Banners were up for the wrong reason at onset and absent for the whole recession bias.
- The How It Works page contradicts this event in four places.

### 8. Most of the evidence needed for this audit was lost [V]
Clean validations keep 7 days and no raw value, stages or flags. Scored forecast rows are deleted.
There are no bin or leaderboard snapshots and no log of what inputs each prediction saw. A run
that completes without producing a prediction looks healthy to the monitoring.

### 9. Thin and flood-born bins are still in force [V]
- 12,000–25,000 steady holds a single observation of +9,743 cfs, created on a capped rising-limb
  row. Blended, it will subtract about 2,790 cfs the next time the river is in that band and steady.
- 12,000–25,000 rising sits at +3,762; 6,000–12,000 rising at −1,350 on four observations.
- A 2 cfs change in raw flow at the 25,000 edge moves the displayed falling-limb value by 1,071 cfs.
- The rising/falling/steady label follows Point of Rocks and matched what Little Falls then did
  on about 62 percent of ticks.

### 10. The 48-hour forecast is fragile and cannot be audited [V]
It is generated only in a browser, so coverage depends on page views. The travel offset is built
on one flow and scored on another. The bias term is one fixed cfs value added to every horizon.
In calm flow after the flood it tied persistence at 6 and 12 hours (8.3 against 7.5, 9.7 against
9.2 percent) and beat it at 24 and 48. The strong flood-window numbers mostly measure how well the
weather service forecast the recession.

### Also noted
- **Creeks tab [S]:** shows "Running!" in green at any flow above the threshold. Difficult Run
  was at 8 times its threshold for hours with no high-water state.
- **Edwards Ferry [V]:** its stage responded to the Monocacy before the main wave, and the power
  law over-reads at the crest, exactly where its weight is near the 40 percent maximum.
- **Orphan writer [V]:** nine `rise_event` rows reappeared after v37.1 deleted them, on a
  quarter-hour schedule that is not this app's cron. Something outside this codebase may still be
  attempting writes every 15 minutes.
- **No age check on any gauge input [V]:** the estimate takes the last value of each series
  however old; Little Falls was 65 to 70 minutes stale on 3 of 39 logged ticks.
- **Shadow leaderboard [V]:** cumulative only, so it says nothing about this event.

## Not traced by anyone
The browser's own estimate; the Great Falls inputs panel and history graph; All Gauges flood
rings and trend arrows; the map; what the Learning tab displayed during the event; stage-bin
learning; client shadow models; mobile layout; error monitoring.

## Suggested order of work

| # | Action | Why first | Size |
|---|---|---|---|
| 1 | Make the cache network-first for river data and drive "Updated" from reading time | User-facing, safety-relevant, small | small |
| 2 | Decide what to do with the single-observation +9,743 bin | Live hazard at the next 12–25k steady flow | decision |
| 3 | Log each prediction's inputs, raw value, flags and whether the cap bound; keep clean rows longer | Every other item needs this to be measured | small |
| 4 | Show when the 120 percent cap is active; stop capped rows from training bins | Honesty, and stops bins learning an artifact (2026-11-10: the second half, stop capped rows from training bins, was found to be aimed at the wrong cause; see the correction under problem 4. Only the indicator was done, as A4a.) | small–medium |
| 5 | Subtract Difficult Run from the validation truth, or flag validations when it is high | Removes a known contaminant from learning | medium, needs a backtest |
| 6 | Reopen multi-pending validation for responsiveness | Learning was 23 hours late at onset | large, was rejected once |
| 7 | Fix the rising-limb travel lookup and review the delta correction | Largest raw-model error, but magnitudes unverified | large, needs item 3 first |
| 8 | Rebuild the confidence band and labels from live residuals | They currently inform nobody | medium |
| 9 | Creeks tab high-water state; How It Works corrections | Safety wording | small |
| 10 | Find the orphan `rise_event` writer | Unknown process writing to the database | investigation |

Items 5 to 8 change the model or its scoring and fall under the project's plan, audit,
dual-language verification protocol. Items 6 and 7 should not be attempted on this event alone.

## Files
- `PLAN.md`, `PLAN_AUDIT.txt` — plan and its independent audit.
- `REPLAY_NOTES.md`, `REPLAY_REPORT.txt` — replay method, column dictionary, fidelity result.
- `CRITIC.txt` — completeness critic's full text, including the three gap investigations.
- `ALL_RESULTS.json` — every finding with its verifier verdict and corrected statement.
- `audit_outputs.tar.gz` — all scripts, replay datasets and per-aspect notes.
- `audit_inputs.tar.gz` — the USGS record and captured rows the audit ran on.

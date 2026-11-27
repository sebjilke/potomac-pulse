# First look: the app's clock from Great Falls to Little Falls on a rise (2026-11-27)

**Status: a first look by the orchestrator. One script per number, no second analyst, no auditor. Nothing here is a verified result and nothing was changed in the app.** Written down so the finding is not lost. Prompted by the owner on 2026-11-27: the app's number was off against the river on the rise of 26 and 27 November, and against the scoring in the locked section.

## What was found

1. **The clock in the code.** The app scores each estimate against Little Falls one travel time later. That travel time is `getGFtoLFTravelTime(mult, porRiseRate)` (`netlify/functions/scheduled-update.js:972`), where `mult` starts from the current Little Falls flow and is replaced by the flow of the Point of Rocks reading the model looked up about a day back whenever that lookup does not converge, which is typical on a rise and was the case that night (`trv.stop = max_iter`). (Corrected on 2026-11-27 after the fact sheet of the clock study: the first wording said the past reading is always used.) The formula is 6.5 hours times a factor that falls with flow (`netlify/functions/shared/model.js:367-371`): about 13 h at 1,540 cfs, 6.5 h at 5,000 cfs, 4.6 h at 8,770 cfs, up to 30% less while Point of Rocks is rising. On the night of 26 to 27 November the logged value was 9 to 14 hours, with Little Falls between 4,000 and 8,800 cfs.
2. **What the record says** (`lag.py`, the hourly input file of 2011 to 2026 and the list of past rises): on 31 past rises the hourly changes at Edwards Ferry and at Little Falls line up best at a lag of about 8 hours (median 8 for rises through 5,000 to 10,000 cfs, most between 6 and 10). Edwards Ferry is about 25.8 river miles above the Little Falls gauge and Great Falls about 9.3. By distance that puts Great Falls to Little Falls at about 3 hours on a rise, likely between 2 and 4. The split by distance is an assumption.
3. **Last night on three clocks** (`look.py`, `look2.py`, `look3.py`; values from the app's `tick_log`, truth from the public Little Falls record). With the app's own clock the 17 hourly runs from 7 am to 11 pm Eastern on 26 November all read 26 to 61% low. With the truth taken 3 hours after each run, the app as shown is off by 9.7% on average over 24 runs (7 am on the 26th to 6 am on the 27th): 10 to 28% low from 7 am to 3 pm, when the model had not seen the creek water and nothing was capped; then within 3% in 12 of the 15 runs from 4 pm on, when the cap held the number (10 to 20% high from 5 to 7 pm, when Little Falls paused). The model without the cap is 39 to 139% too high from 5 pm on.

4. **The last two days on the new clock** (`twodays.py`, 46 hourly runs from 25 November 18:01 UTC to 27 November 15:01 UTC; first-look clock of 6 hours when Little Falls is below 2,500 cfs and 3 hours above, short end 40% of that). Average miss of the app as shown: 34% on the app's own clock (26 of 36 runs badly low); 12% on the long end of the new clock (12 of 43 badly low); 9% on the short end. By part: before the rise 24%, 8%, 3%; the first hours of the rise (7 am to 2 pm Eastern on the 26th) 58%, 39%, 13%; the rise with the cap holding 33%, 5%, 11%. Without the cap in that last part: 82 to 90%.

## What it means, if it holds

- The scoring in the locked section, the headline accuracy and the "reading low" note are too harsh on a rise, because they compare with a later and higher river.
- The corrections learn from the same pairs.
- The cap study, the onset study and the two rising-limb studies took their truth on the app's clock. The cap study's own timing table says an earlier truth makes every looser rule look worse, so "keep the cap" gets firmer. Its figures for the large rises (for example "badly low on 43% of hours") are probably far too pessimistic about the cap.
- A cap that follows Little Falls' rise over the app's travel time (the rule LF6 as studied) would overshoot on the right clock.

## Not established

The true travel time by flow, on rising, falling and low water. Whether the split by distance is fair for this reach. How the finished studies change. All of this needs a proper measurement (plan, audit, two analysts, auditor) before any change to the app.

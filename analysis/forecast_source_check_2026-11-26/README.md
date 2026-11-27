# Source check: is there a longer river forecast than the one the app uses? (TODO A3r)

Started 2026-11-26 on the owner's word ("check the source"). Read-only. Nothing here feeds the app.

## Why

The app's 48 h card reads the Weather Service's official forecast for Little Falls at the target hour plus the travel time from Great Falls. That forecast reaches 46 to 70 hours ahead, depending on its age. When it does not reach far enough, the app holds the last value. A source with a longer reach would close that gap. The Weather Service's own river model lists longer series for the same stretch of river. The question: are they served, and are they any use?

## What was found (2026-11-26, 21:36 UTC)

1. **The 10-day series is served only at some hours** (corrected on 2026-11-27, see the note under this list). First reading on 2026-11-26: `medium_range` and `medium_range_blend` came back empty for every reach asked: ours (4512772), Point of Rocks, Harrisburg, St. Louis, Memphis, and the reaches just above and below ours. So this is the state of the service, not a gap at our reach. On 2026-11-25 at 16:40 UTC they were empty as well.
2. **The 30-day series is served on and off.** `long_range` had data on 2026-11-26 at 21:36 UTC (the run of 12:00 UTC: a mean and four members, 120 points each, 6 hours apart, 710 hours ahead). On 2026-11-25 at 16:40 UTC it was empty.
3. **In its first real test the 30-day series did not see a rise.** A first look at one day, not a study. On 2026-11-26 the official forecast (issued 15:00 UTC) has Little Falls going from 2,850 cfs to 21,000 cfs within 62 hours, still rising at its last point. For the same hours the 30-day series stays between 2,500 and 3,000 cfs, and its four members differ by no more than 25 cfs. Little Falls had already risen from about 1,500 to 3,400 cfs that day. Which of the two is closer to what the river did will be known in a few days; the samples kept here and the app's own archive hold both.
4. **The 18-hour series** (`short_range`, hourly) and the model's current state are served every time so far.

**Correction, 2026-11-27.** Point 1 said the 10-day series is not served at all. That was wrong. In the sample of 2026-11-27 02:13 UTC `medium_range` had data (the run of 18:00 UTC: a mean and six members, 240 hourly points, 232 hours ahead), `medium_range_blend` as well, and `long_range` was empty. The 10-day and the 30-day series alternate from sample to sample. `source_samples.csv` shows which was there when.

## Reading so far

No longer source that could be used as it is. The natural candidate (10 days) is there only at some hours and has not been looked at yet. The 30-day one expects almost no change while the official forecast expects a sevenfold rise. It could only be considered after it has been kept and scored for a long time, like any source, and nothing in this first look speaks for it.

## The samples

- `check_source.py`: one run takes one sample. Three plain requests, no key, nothing but a reach id or a gauge id in the address.
- `source_samples.csv`: one line per series per sample (when sampled, how many points, the model run, how far ahead the last point lies, first and last flow).
- `samples/`: for each sample the raw answer for our reach, and the official forecast for Little Falls with the last 48 observed readings.
- From 2026-11-26 a timer in the working session runs the script every four hours. It ends with that session, and after 7 days at the latest. The samples are committed at the next working session, not one by one, because every push redeploys the app.

**Samples fail while the laptop is asleep.** The timer runs in the working session, and the machine sleeps with the lid closed. The samples of 2026-11-27 09:11 and 12:57 UTC both carry `request failed: The read operation timed out` for the two river-model requests (the machine fell asleep mid-request); only the official forecast was saved. Such lines say nothing about which series were served.

Two earlier observations were made by hand and are not in the CSV: 2026-11-25 16:40 UTC (our reach only) and 2026-11-26 21:36 UTC (eight reaches). Both are described above.

## Not established

- At which hours the 10-day and the 30-day series are served. In the two full samples so far they alternated (see the correction above).
- How good any of the model series is at Little Falls. One day is no basis for that.

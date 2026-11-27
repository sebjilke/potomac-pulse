# difficult_run_hourly.csv

Hourly discharge (cfs) of USGS 01646000, Difficult Run near Great Falls, VA (parameter 00060), in the same convention as `analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`.

- Stamp `YYYY-MM-DD HH:MM`, UTC, start of the hour. Value = median of all readings in [T, T + 1 h), rounded to 1 decimal, written as the model script writes a flow (for example `25.8`, `8.9`). Empty field when the hour has no reading.
- Header `timestamp,dr_discharge`. One row for every hour from `2011-12-01 05:00` to `2026-11-09 23:00` inclusive, ascending. LF line ends, no quotes.
- Resampling is copied from `resample_to_hourly` in `fetch_hourly_backtest_data_v39.py` (no dedupe).

## Command

    cd analysis/clock_study_2026-11-27/data
    python3 -I fetch_difficult_run_hourly.py

A re-run fetches nothing that is already in `raw/` and rebuilds the CSV from it.

## Source

- Service: `https://waterservices.usgs.gov/nwis/iv/` (public, no key, no custom headers). A request carries only `sites=01646000`, `parameterCd=00060`, `startDT`, `endDT` and `format=json`.
- Requests: 182 chunks of up to 30 days, covering 2011-12-01T05:00Z to 2026-11-10T00:00Z. Fetched on 2026-11-27.
- The download ran in four attempts on 2026-11-27 because it hung while the computer slept. Each attempt picked up from the files already in `raw/`.

## Contents

- Rows written: 130,987 (equal to the number of hours in the span).
- Hours with a value: 129,851. Empty hours: 1,136. Readings used: 516,278. Readings flagged as missing (for example -999999): 0. Unparsable readings: 0.
- Hours with a value per calendar year: 2011: 739 (starts 2011-12-01 05:00), 2012: 8,688, 2013: 8,663, 2014: 8,471, 2015: 8,448, 2016: 8,729, 2017: 8,733, 2018: 8,570, 2019: 8,724, 2020: 8,784, 2021: 8,760, 2022: 8,760, 2023: 8,760, 2024: 8,784, 2025: 8,726, 2026: 7,512 (ends 2026-11-09 23:00).
- Five longest gaps (start UTC, hours): 2014-01-22 05:00, 216; 2015-02-13 05:00, 168; 2013-01-28 05:00, 72; 2014-01-04 05:00, 72; 2012-10-10 04:00, 48. There are 190 gap runs in all.
- SHA-256: `fc35a7fc5440823b04cfb287e52d212cc48eef6e7b69489ec8901f1cea17f4e0`. Size: 2,879,671 bytes.

## Unusual

- Qualifier codes in the answers: `A` (approved, 508,290 readings), `P` (provisional, 7,988), `e` (the service describes it as "Value has been estimated", 1,422). No ice or equipment codes. Estimated and provisional readings are kept like any other.
- Reading interval: 15 minutes throughout. No change to 5 minutes. Most hours have 4 readings. Hours with fewer than 4 readings occur every year after 2011 (for example 1 reading: 255 hours in 2021, 338 in 2022; 2 or 3 readings: a few to about 35 hours per year). Eight hours have 5 readings (2017: 1, 2018: 2, 2019: 2, 2020: 1, 2021: 1, 2022: 1). The median is taken over whatever readings the hour has.
- No zero or negative values.
- Each answer held one time series, so the "no dedupe" rule changes nothing here.
- Service quirk: in daylight-saving months a request whose `startDT`/`endDT` end in `Z` returns readings one hour earlier than asked. The chunk joins were checked: every join is 15 minutes apart except three real data gaps (2017-08-01, 2017-12-29, 2025-01-21) and the 2015 gap, so no hour was lost or doubled. Stamps come from each reading's own time stamp converted to UTC, so they are correct.

# Build log: freeze and tidy tables

Data builder log, 2026-11-22. Everything here was produced by the scripts in this folder from frozen raw files; no table was edited by hand. Counts are copied from `data/tidy/BUILD_REPORT.json` (written by tools/03) and `data/tidy/RECONCILE.json` (written by the independent recount, tools/05). No analysis was done and no old value was compared with a current value.

Pull time (USGS): plan fixed at 2026-11-22T10:57:50Z; first request 10:57:56Z, last request 11:03:51Z (UTC). Window cutoff (last full hour before the first pull): **2026-11-22T10:00:00Z**. Supabase export: about 2026-11-22 10:51 UTC (orchestrator), all rows `created_at < 2026-11-22 10:30:00+00`.

## Step 1. tools/01_freeze_local.py

| item | in | out | note |
|---|---|---|---|
| tick_log export | 305 rows | data/raw/supabase/tick_log.json, 305 rows | sha256 b320a842...67c2 (full hashes in data/MANIFEST.json) |
| validation_log export | 20 rows | validation_log.json, 20 rows | |
| bin and state rows | 97 rows (bin_snapshot 12, gf_correction_bin 28, gf_metadata 1, gf_prediction 2, validation_failure 54) | state_rows.json, 97 rows | counts asserted in the script |
| archive (old service, 2026-11-10) | 54 data files + FETCH_MANIFEST.json (55 files, 23 MB) | all 54 verified against FETCH_MANIFEST.json (sha256 and bytes), 0 mismatches; `archive_old_2026-11-10.tar.gz` 1,002,715 bytes (about 1 MB; deterministic: sorted members, mtime 0); extracted working copy `data/raw/archive_old/` (55 files) re-verified against the manifest | |
| October pull | member data/usgs_iv_2026-10-05_2026-10-22.json of audit_inputs.tar.gz | data/raw/oct_pull/usgs_iv_2026-10-05_2026-10-22.json, 4,533,844 bytes | other three tar members (snapshots, captured context) not extracted: not requested |

Note on the exports: the text of each export has a warning sentence that itself mentions the `<untrusted-data-...>` tag name before the real data block. The script takes the data between the second opening tag and the last closing tag (checked: row counts equal the counts given).

## Step 2. tools/02_pull_usgs.py (USGS new service, keyless)

Requests: **21 HTTP requests, all HTTP 200, 0 refusals, 0 retries, 0 HTTP 429**. 1 probe + 20 pulls. Spacing: 15.0 to 60 s between request starts (the 60 s gap before t5 is my restart of the process, not a wait forced by the service). No rate-limit headers of any kind were present in any response (searched for rate, limit, retry, remain in all 21 header sets: none), so the allowance is still unknown. Total time of the pull: about 6 minutes.

Probe (one request, Point of Rocks flow, 6 hours, `limit=50000`): accepted with HTTP 200, 72 rows, all statistic 00011; `links` has no `next` when everything fits. Paging, learned on the first larger answers: when an answer is full (exactly 50,000 rows) it carries a `links` entry with rel `next` whose address holds a `cursor=` parameter and the same filters; the cursor walks site by site then time. Largest limit accepted: 50,000 (the documented maximum; not tested higher). Properties requested: monitoring_location_id, parameter_code, statistic_id, time, value, approval_status, qualifier, last_modified, time_series_id (the first, second and last were added to the list in the brief so that several gauges and parameters can share a request and a repeated series can be detected).

Planning to minimise requests: a series at 5-minute spacing from 12 Jun to the cutoff is 47,064 rows, below the 50,000 cap, so Point of Rocks flow and level and Little Falls flow and level each took exactly one request. Gauges with 15-minute data share requests. Every answer is saved as a gzip of the uncompressed body (`data/raw/usgs/<pull>_pNNN.json.gz`) with one log entry per attempt in `data/raw/usgs/PULL_LOG.json` (full URL, request time UTC with microseconds, HTTP status, all response headers, transferred bytes, uncompressed bytes, SHA-256 of the uncompressed body, file). `data/MANIFEST.json` repeats url, time obtained and both hashes per raw file.

| pull | priority tier | requests | rows (features) | complete |
|---|---|---|---|---|
| probe_por_00060_6h | probe | 1 | 72 | yes (not used in any table) |
| t1_por_00060, t1_por_00065 (Point of Rocks flow, level, 12 Jun to cutoff) | 1 | 2 | 47,064 each | yes |
| t2_lf_00060 / t2_lf_00065 (Little Falls) | 2 | 2 | 47,030 / 47,042 | yes |
| t3_fm_por_lf (field measurements, PoR + LF, no time filter) | 3 | 1 | 2,095 (PoR 1,196; LF 899) | yes, no `next` link |
| t3b_sites_all (monitoring-locations, `id=` filter for 15 gauges) | 3 | 1 | 15 | yes |
| t4_mono_goose_00060 | 4 | 1 | 31,377 | yes |
| t4_br_sen_00060 | 4 | 2 | 94,130 | yes (page 1 full: 50,000) |
| t4_ef_00065 (Edwards Ferry level) | 4 | 1 | 15,689 | yes |
| t4_por_00010 (Point of Rocks temperature) | 4 | 1 | 46,469 | yes |
| t5_upstream (8 gauges, flow + level, 1 Sep to cutoff) | 5 | 3 | 126,281 | yes |
| t6_census_por_00060 (24-month extension, 2024-11-22T10:00Z to 2026-06-11T23:59:59Z) | 6 | 2 | 63,935 | yes |
| t6_census_lf_00060 | 6 | 3 | 113,013 | yes |
| t7_fm_upstream (8 gauges, since 2025-01-01) | 7 | 1 | 379 | yes |

All pulls complete; the 24-month census extension was obtained in full (no narrowing needed). Pulls t6 cover only the part before 2026-06-12; tidy `readings_current_census.csv` joins them with the 12 Jun to cutoff rows of the same two flow series (t1_por_00060, t2_lf_00060) so it spans 24 months by itself (it repeats those rows, see DICTIONARY).

Site-number confirmation against `monitoring-locations` (saved as t3b_sites_all_p001.json.gz and sites.csv): all 15 numbers are the named sites, drainage areas in square miles as given: 01618000 POTOMAC RIVER AT SHEPHERDSTOWN, WV (5955); 01613000 POTOMAC RIVER AT HANCOCK, MD (4064); 01610000 POTOMAC RIVER AT PAW PAW, WV (3129); 01636500 SHENANDOAH RIVER AT MILLVILLE, WV (3041); 01619500 ANTIETAM CREEK NEAR SHARPSBURG, MD (281); 01614500 CONOCOCHEAGUE CREEK AT FAIRVIEW, MD (494); 01616500 OPEQUON CREEK NEAR MARTINSBURG, WV (272); 01637500 CATOCTIN CREEK NEAR MIDDLETOWN, MD (66.9); 01638500 POTOMAC RIVER AT POINT OF ROCKS, MD (9651); 01643000 MONOCACY RIVER AT JUG BRIDGE NEAR FREDERICK, MD (817); 01644000 GOOSE CREEK NEAR LEESBURG, VA (332); 01644148 POTOMAC RIVER AT EDWARDS FERRY NEAR POOLESVILLE,MD (11130); 01644280 BROAD RUN NEAR LEESBURG, VA (76.1); 01645000 SENECA CREEK AT DAWSONVILLE, MD (101); 01646500 POTOMAC RIVER NEAR WASH, DC LITTLE FALLS PUMP STA (11560). No mismatch.

Rows with a statistic other than 00011 in any continuous answer: 0 (the filter is applied and counted anyway). Upstream pulls got both parameters for all eight gauges.

## Step 3. tools/03_build_tidy.py

Readings tables (long format). Rules applied: statistic 00011 only; null and -999999 become blank and are counted; no interpolation, resampling or de-duplication except exact duplicate rows (counted: 0 in every table); times parsed to UTC.

| table | raw features in | dropped (not 00011) | exact duplicates dropped | rows out | blank values (null / sentinel) |
|---|---|---|---|---|---|
| readings_old_archive.csv | 303,659 (54 files) | 0 | 0 | 303,659 | 0 / 5 |
| readings_old_octpull.csv | 57,135 (15 series; 4 empty value blocks of Little Falls temperature ignored, listed as discontinued methods) | 0 | 0 | 57,135 | 0 / 0 |
| readings_current_model.csv | 375,865 (9 pages, 8 pulls) | 0 | 0 | 375,865 | 5 / 0 |
| readings_current_upstream.csv | 126,281 (3 pages) | 0 | 0 | 126,281 | 0 / 0 |
| readings_current_census.csv | 271,042 (7 pages) | 0 | 0 | 271,042 | 2 / 0 |

The five blanks in the archive and the five in the model table are the same five instants (Point of Rocks temperature 2026-10-30T16:25Z; Little Falls flow and level 2026-11-07T19:50Z and 20:40Z); the two blanks in the census table are the Little Falls flow rows of those last two. Rows with the same (gauge, parameter, time) but different content within a table: 0.

Other tables:

| table | in | out | note |
|---|---|---|---|
| runs.csv | tick_log 305 rows | 305 rows, 180 columns | `used` = 1 on 275 rows (first predicted row of each clock hour); rows_in_hour as specified. 20 columns that were whole-object nulls in every row where they exist (`ci`, `ef`, `corr`, ... listed in BUILD_REPORT.json) were not written as separate columns: their leaf columns are present and blank on those rows |
| runs_tails.csv | arrays in tick_log (Difficult Run tail, Edwards Ferry stage tail) | 9,803 rows | recount from raw: 9,803 |
| checks.csv | validation_log 20 rows | 20 rows, 116 columns | all outcome `validated`; no tail arrays in this log (checks_tails.csv not written) |
| bins.csv | 12 bin_snapshot rows x 28 bins + 28 gf_correction_bin rows | 336 + 28 = 364 rows | snapshot time of gf_correction_bin rows is set to the export time 2026-11-22T10:51:00Z (their own update time is not in the export), flagged in the dictionary |
| state_other.json | gf_metadata 1, gf_prediction 2, validation_failure 54, plus the `lb` leaderboard of the 12 snapshots | 57 rows + 12 leaderboards | |
| field_measurements.csv | 2,474 features (2,095 PoR+LF; 379 upstream) | 2,474 rows | 0 exact duplicates; 2 rows have identical content to another row but a different feature_id (PoR level 1.20 ft on 1905-11-09 and 3.69 ft on 2008-06-02); both kept |
| sites.csv | 15 | 15 rows, 45 columns | |
| MANIFEST.json | | 85 raw files with bytes, sha256, origin, time obtained | |

Reconciliation (tools/05_reconcile.py, an independent recount of the raw files against the tidy row counts): all 12 count checks equal; 54 seeded random cell traces (6 per readings table = 30, plus 6 runs rows x 4 columns = 24), all traced back to the raw value and time, 0 failures.

### Hand check of the time-zone handling (old-service file 01638500_00060_20261010_20261109.json, Point of Rocks flow)

| raw dateTime | my UTC (table value) | arithmetic |
|---|---|---|
| 2026-10-31T20:00:00.000-04:00 (value 1640) | 2026-11-01T00:00:00Z | -04:00: add 4 h, the evening of 31 Oct becomes 00:00 on 1 Nov |
| 2026-11-01T01:00:00.000-04:00 (value 1720) | 2026-11-01T05:00:00Z | -04:00: add 4 h |
| 2026-11-01T01:00:00.000-05:00 (value 1760) | 2026-11-01T06:00:00Z | -05:00 after the change: add 5 h; the repeated local hour 01:00 appears once with each offset and the two UTC values are one hour apart |
| 2026-11-01T20:00:00.000-05:00 (value 1640) | 2026-11-02T01:00:00Z | -05:00: add 5 h |

The offset in each raw string, not the date, decides the conversion; times on both sides of 2026-11-01 (and the repeated hour) come out contiguous at 5-minute spacing in the table (step histogram of the series: 43,499 steps of 5 minutes, no other step).

## Anomalies met (facts only)

1. **Old-service window starts one hour early in daylight-time months.** Every archive file whose first reading falls in -04:00 time starts at 23:00Z of the day BEFORE the requested start and ends at 22:55Z of its last day (for example the file requested 2026-06-12T00:00Z to 2026-07-11T23:59Z holds readings from 2026-06-11T23:00:00Z to 2026-07-11T22:55:00Z). The files starting on 2026-11-09 (-05:00 time) start exactly at the requested 00:00Z. The October pull shows the same pattern (first reading 2026-10-04T23:00Z for a request starting 2026-10-05T00:00Z; last 2026-10-21T23:00Z). My conversion follows the offset in every `dateTime`. Two readings are possible: (a) the labels are right and the old service widened or shifted its window by an hour in daylight time; (b) the labels in daylight months are one hour off. The sequence at the 1 Nov change (01:55 -04:00 then 01:00 -05:00, contiguous in UTC) is what (a) gives. This cannot be settled from the old files alone; it would take comparing an old series with a new-service series that was not revised (not done: the brief forbids comparing old and current values). Flagged for the orchestrator because R1 compares at identical timestamps.
2. **Newest readings lag the cutoff.** At pull time (about 10:58 to 11:04 UTC) the newest reading is 09:55Z for Point of Rocks flow, level and temperature and 09:45Z for Goose Creek; 10:00Z for Monocacy, Broad Run, Seneca, Edwards Ferry and Little Falls. So the last full hour is not complete for every series.
3. **Sentinel/null readings:** see above (5 instants, same in old and new).
4. **Gaps in series (counts of steps, not interpolated):** see Appendix B. Examples: Point of Rocks temperature has one 60-minute and one 35-minute step; Broad Run (old archive) one 965-minute step; Paw Paw flow and level six 30-minute steps each; Catoctin Creek flow twenty 120-minute steps and Catoctin level one 2,475-minute step; Point of Rocks flow census has 140 steps of 240 minutes (older, coarser data). The 24-month census series have mixed spacing (5 and 15 minutes).
5. **Old archive files list 54 data files; the plan text says 55 (it counts FETCH_MANIFEST.json).**
6. **tick_log:** 305 rows from 2026-11-10T21:00:56.805Z to 2026-11-22T10:00:53.551Z. Outcomes: predicted 280, error 25 (all `usgs_fetch_failed`, "Failed to fetch USGS data"). `ver`: v39.2 2 rows, v39.6 189, v39.11 114; schema `v` 1 / 2 / 3 respectively. `src` is `new` on all 114 v39.11 rows. 278 clock hours from first to last. `used` = 1 on 275 hours.
   - Hours with more than one row (18, row count in brackets): 2026-11-16 18h (2), 2026-11-16 20h (3), 2026-11-16 22h (3), 2026-11-16 23h (2), 2026-11-17 00h (2), 2026-11-17 01h (2), 2026-11-17 03h (3), 2026-11-17 04h (2), 2026-11-17 05h (3), 2026-11-17 06h (2), 2026-11-17 07h (2), 2026-11-17 08h (2), 2026-11-17 09h (2), 2026-11-17 10h (3), 2026-11-17 12h (3), 2026-11-17 14h (3), 2026-11-17 15h (3), 2026-11-17 16h (3).
   - Error rows (25, UTC): 11-16 18:00:56, 11-16 20:01:10, 11-16 22:01:08, 11-16 22:01:20, 11-16 23:00:54, 11-17 00:00:55, 11-17 03:00:53, 11-17 03:01:05, 11-17 03:01:14, 11-17 04:00:52, 11-17 05:00:54, 11-17 05:01:05, 11-17 07:00:54, 11-17 08:00:54, 11-17 10:00:52, 11-17 10:01:04, 11-17 10:01:15, 11-17 12:00:55, 11-17 12:01:06, 11-17 12:01:18, 11-17 14:00:55, 11-17 14:01:07, 11-17 15:00:55, 11-17 15:01:06, 11-17 16:00:59.
   - Clock hours between the first and last run with no predicted row (3, each has only error rows): 11-17 03h, 11-17 10h, 11-17 12h.
   - Every row has gauge_id equal to its own `at`.
7. **Export wrapper:** the Supabase result text contains the tag name once in a warning sentence before the data (see Step 1).
8. **Probe vs pull:** the probe's 6-hour window for Point of Rocks flow returned 72 rows ending at 09:55Z although the window end was 10:00Z (the 10:00 reading was not yet published at 10:58Z).
9. Nothing that looks like a finding was noticed; no pattern in the data was looked at.

## What could not be pulled / not done

- Nothing in the pull list was refused or left out. All seven tiers complete, including the 24-month census extension (not narrowed).
- Not done, by instruction: any database query, any comparison of old with current values, `tz` confirmation by value comparison (anomaly 1).
- Not extracted: the three other members of audit_inputs.tar.gz.
- The `used` rule is the plan's (first predicted row of each clock hour); no other rule was applied.
- `data/tidy/state_other.json` keeps rows as exported; the `validation_failure` rows (54) are not flattened.
- A "gauge 01646000 Difficult Run" tail is in runs_tails.csv as logged; it is a logging-only field.

## Appendix A. Rows per raw source file (generated from data/tidy/BUILD_REPORT.json)

Columns: features in the raw file for the table | dropped (statistic not 00011) | blank value from null | blank value from sentinel -999999 | exact duplicate rows dropped | rows written. Always features = dropped + duplicates + written.

### readings_old_archive (303659 rows)

| source file | in | dropped | blank null | blank sentinel | dups | written | first utc | last utc |
|---|---|---|---|---|---|---|---|---|
| archive_old/01638500_00010_20260612_20260712.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-06-11T23:00:00Z | 2026-07-11T22:55:00Z |
| archive_old/01638500_00010_20260712_20260811.json | 8623 | 0 | 0 | 0 | 0 | 8623 | 2026-07-11T23:00:00Z | 2026-08-10T22:55:00Z |
| archive_old/01638500_00010_20260811_20260910.json | 8638 | 0 | 0 | 0 | 0 | 8638 | 2026-08-10T23:00:00Z | 2026-09-09T22:55:00Z |
| archive_old/01638500_00010_20260910_20261010.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-09-09T23:00:00Z | 2026-10-09T22:55:00Z |
| archive_old/01638500_00010_20261010_20261109.json | 8076 | 0 | 0 | 1 | 0 | 8076 | 2026-10-09T23:00:00Z | 2026-11-08T23:55:00Z |
| archive_old/01638500_00010_20261109_20261110.json | 288 | 0 | 0 | 0 | 0 | 288 | 2026-11-09T00:00:00Z | 2026-11-09T23:55:00Z |
| archive_old/01638500_00060_20260612_20260712.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-06-11T23:00:00Z | 2026-07-11T22:55:00Z |
| archive_old/01638500_00060_20260712_20260811.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-07-11T23:00:00Z | 2026-08-10T22:55:00Z |
| archive_old/01638500_00060_20260811_20260910.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-08-10T23:00:00Z | 2026-09-09T22:55:00Z |
| archive_old/01638500_00060_20260910_20261010.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-09-09T23:00:00Z | 2026-10-09T22:55:00Z |
| archive_old/01638500_00060_20261010_20261109.json | 8652 | 0 | 0 | 0 | 0 | 8652 | 2026-10-09T23:00:00Z | 2026-11-08T23:55:00Z |
| archive_old/01638500_00060_20261109_20261110.json | 288 | 0 | 0 | 0 | 0 | 288 | 2026-11-09T00:00:00Z | 2026-11-09T23:55:00Z |
| archive_old/01643000_00060_20260612_20260712.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-06-11T23:00:00Z | 2026-07-11T22:45:00Z |
| archive_old/01643000_00060_20260712_20260811.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-07-11T23:00:00Z | 2026-08-10T22:45:00Z |
| archive_old/01643000_00060_20260811_20260910.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-08-10T23:00:00Z | 2026-09-09T22:45:00Z |
| archive_old/01643000_00060_20260910_20261010.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-09-09T23:00:00Z | 2026-10-09T22:45:00Z |
| archive_old/01643000_00060_20261010_20261109.json | 2884 | 0 | 0 | 0 | 0 | 2884 | 2026-10-09T23:00:00Z | 2026-11-08T23:45:00Z |
| archive_old/01643000_00060_20261109_20261110.json | 96 | 0 | 0 | 0 | 0 | 96 | 2026-11-09T00:00:00Z | 2026-11-09T23:45:00Z |
| archive_old/01644000_00060_20260612_20260712.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-06-11T23:00:00Z | 2026-07-11T22:45:00Z |
| archive_old/01644000_00060_20260712_20260811.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-07-11T23:00:00Z | 2026-08-10T22:45:00Z |
| archive_old/01644000_00060_20260811_20260910.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-08-10T23:00:00Z | 2026-09-09T22:45:00Z |
| archive_old/01644000_00060_20260910_20261010.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-09-09T23:00:00Z | 2026-10-09T22:45:00Z |
| archive_old/01644000_00060_20261010_20261109.json | 2884 | 0 | 0 | 0 | 0 | 2884 | 2026-10-09T23:00:00Z | 2026-11-08T23:45:00Z |
| archive_old/01644000_00060_20261109_20261110.json | 96 | 0 | 0 | 0 | 0 | 96 | 2026-11-09T00:00:00Z | 2026-11-09T23:45:00Z |
| archive_old/01644148_00065_20260612_20260712.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-06-11T23:00:00Z | 2026-07-11T22:45:00Z |
| archive_old/01644148_00065_20260712_20260811.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-07-11T23:00:00Z | 2026-08-10T22:45:00Z |
| archive_old/01644148_00065_20260811_20260910.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-08-10T23:00:00Z | 2026-09-09T22:45:00Z |
| archive_old/01644148_00065_20260910_20261010.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-09-09T23:00:00Z | 2026-10-09T22:45:00Z |
| archive_old/01644148_00065_20261010_20261109.json | 2880 | 0 | 0 | 0 | 0 | 2880 | 2026-10-09T23:00:00Z | 2026-11-08T23:45:00Z |
| archive_old/01644148_00065_20261109_20261110.json | 96 | 0 | 0 | 0 | 0 | 96 | 2026-11-09T00:00:00Z | 2026-11-09T23:45:00Z |
| archive_old/01644280_00060_20260612_20260712.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-06-11T23:00:00Z | 2026-07-11T22:55:00Z |
| archive_old/01644280_00060_20260712_20260811.json | 8448 | 0 | 0 | 0 | 0 | 8448 | 2026-07-11T23:00:00Z | 2026-08-10T22:55:00Z |
| archive_old/01644280_00060_20260811_20260910.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-08-10T23:00:00Z | 2026-09-09T22:55:00Z |
| archive_old/01644280_00060_20260910_20261010.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-09-09T23:00:00Z | 2026-10-09T22:55:00Z |
| archive_old/01644280_00060_20261010_20261109.json | 8652 | 0 | 0 | 0 | 0 | 8652 | 2026-10-09T23:00:00Z | 2026-11-08T23:55:00Z |
| archive_old/01644280_00060_20261109_20261110.json | 288 | 0 | 0 | 0 | 0 | 288 | 2026-11-09T00:00:00Z | 2026-11-09T23:55:00Z |
| archive_old/01645000_00060_20260612_20260712.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-06-11T23:00:00Z | 2026-07-11T22:55:00Z |
| archive_old/01645000_00060_20260712_20260811.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-07-11T23:00:00Z | 2026-08-10T22:55:00Z |
| archive_old/01645000_00060_20260811_20260910.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-08-10T23:00:00Z | 2026-09-09T22:55:00Z |
| archive_old/01645000_00060_20260910_20261010.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-09-09T23:00:00Z | 2026-10-09T22:55:00Z |
| archive_old/01645000_00060_20261010_20261109.json | 8652 | 0 | 0 | 0 | 0 | 8652 | 2026-10-09T23:00:00Z | 2026-11-08T23:55:00Z |
| archive_old/01645000_00060_20261109_20261110.json | 288 | 0 | 0 | 0 | 0 | 288 | 2026-11-09T00:00:00Z | 2026-11-09T23:55:00Z |
| archive_old/01646500_00060_20260612_20260712.json | 8632 | 0 | 0 | 0 | 0 | 8632 | 2026-06-11T23:00:00Z | 2026-07-11T22:55:00Z |
| archive_old/01646500_00060_20260712_20260811.json | 8635 | 0 | 0 | 0 | 0 | 8635 | 2026-07-11T23:00:00Z | 2026-08-10T22:55:00Z |
| archive_old/01646500_00060_20260811_20260910.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-08-10T23:00:00Z | 2026-09-09T22:55:00Z |
| archive_old/01646500_00060_20260910_20261010.json | 8639 | 0 | 0 | 0 | 0 | 8639 | 2026-09-09T23:00:00Z | 2026-10-09T22:55:00Z |
| archive_old/01646500_00060_20261010_20261109.json | 8635 | 0 | 0 | 2 | 0 | 8635 | 2026-10-09T23:00:00Z | 2026-11-08T23:55:00Z |
| archive_old/01646500_00060_20261109_20261110.json | 288 | 0 | 0 | 0 | 0 | 288 | 2026-11-09T00:00:00Z | 2026-11-09T23:55:00Z |
| archive_old/01646500_00065_20260612_20260712.json | 8639 | 0 | 0 | 0 | 0 | 8639 | 2026-06-11T23:00:00Z | 2026-07-11T22:55:00Z |
| archive_old/01646500_00065_20260712_20260811.json | 8639 | 0 | 0 | 0 | 0 | 8639 | 2026-07-11T23:00:00Z | 2026-08-10T22:55:00Z |
| archive_old/01646500_00065_20260811_20260910.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-08-10T23:00:00Z | 2026-09-09T22:55:00Z |
| archive_old/01646500_00065_20260910_20261010.json | 8640 | 0 | 0 | 0 | 0 | 8640 | 2026-09-09T23:00:00Z | 2026-10-09T22:55:00Z |
| archive_old/01646500_00065_20261010_20261109.json | 8635 | 0 | 0 | 2 | 0 | 8635 | 2026-10-09T23:00:00Z | 2026-11-08T23:55:00Z |
| archive_old/01646500_00065_20261109_20261110.json | 288 | 0 | 0 | 0 | 0 | 288 | 2026-11-09T00:00:00Z | 2026-11-09T23:55:00Z |

### readings_old_octpull (57135 rows)

| source file | in | dropped | blank null | blank sentinel | dups | written | first utc | last utc |
|---|---|---|---|---|---|---|---|---|
| oct_pull/usgs_iv_2026-10-05_2026-10-22.json | 57135 | 0 | 0 | 0 | 0 | 57135 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z |

### readings_current_model (375865 rows)

| source file | in | dropped | blank null | blank sentinel | dups | written | first utc | last utc |
|---|---|---|---|---|---|---|---|---|
| usgs/t1_por_00060_p001.json.gz | 47064 | 0 | 0 | 0 | 0 | 47064 | 2026-06-12T00:00:00Z | 2026-11-22T09:55:00Z |
| usgs/t1_por_00065_p001.json.gz | 47064 | 0 | 0 | 0 | 0 | 47064 | 2026-06-12T00:00:00Z | 2026-11-22T09:55:00Z |
| usgs/t2_lf_00060_p001.json.gz | 47030 | 0 | 2 | 0 | 0 | 47030 | 2026-06-12T00:00:00Z | 2026-11-22T10:00:00Z |
| usgs/t2_lf_00065_p001.json.gz | 47042 | 0 | 2 | 0 | 0 | 47042 | 2026-06-12T00:00:00Z | 2026-11-22T10:00:00Z |
| usgs/t4_mono_goose_00060_p001.json.gz | 31377 | 0 | 0 | 0 | 0 | 31377 | 2026-06-12T00:00:00Z | 2026-11-22T10:00:00Z |
| usgs/t4_br_sen_00060_p001.json.gz | 50000 | 0 | 0 | 0 | 0 | 50000 | 2026-06-12T00:00:00Z | 2026-11-22T10:00:00Z |
| usgs/t4_br_sen_00060_p002.json.gz | 44130 | 0 | 0 | 0 | 0 | 44130 | 2026-06-22T04:35:00Z | 2026-11-22T10:00:00Z |
| usgs/t4_ef_00065_p001.json.gz | 15689 | 0 | 0 | 0 | 0 | 15689 | 2026-06-12T00:00:00Z | 2026-11-22T10:00:00Z |
| usgs/t4_por_00010_p001.json.gz | 46469 | 0 | 1 | 0 | 0 | 46469 | 2026-06-12T00:00:00Z | 2026-11-22T09:55:00Z |

### readings_current_upstream (126281 rows)

| source file | in | dropped | blank null | blank sentinel | dups | written | first utc | last utc |
|---|---|---|---|---|---|---|---|---|
| usgs/t5_upstream_p001.json.gz | 50000 | 0 | 0 | 0 | 0 | 50000 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z |
| usgs/t5_upstream_p002.json.gz | 50000 | 0 | 0 | 0 | 0 | 50000 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z |
| usgs/t5_upstream_p003.json.gz | 26281 | 0 | 0 | 0 | 0 | 26281 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z |

### readings_current_census (271042 rows)

| source file | in | dropped | blank null | blank sentinel | dups | written | first utc | last utc |
|---|---|---|---|---|---|---|---|---|
| usgs/t6_census_por_00060_p001.json.gz | 50000 | 0 | 0 | 0 | 0 | 50000 | 2024-11-22T10:00:00Z | 2026-04-24T14:40:00Z |
| usgs/t6_census_por_00060_p002.json.gz | 13935 | 0 | 0 | 0 | 0 | 13935 | 2026-04-24T14:45:00Z | 2026-06-11T23:55:00Z |
| usgs/t6_census_lf_00060_p001.json.gz | 50000 | 0 | 0 | 0 | 0 | 50000 | 2024-11-22T10:00:00Z | 2025-10-10T17:40:00Z |
| usgs/t6_census_lf_00060_p002.json.gz | 50000 | 0 | 0 | 0 | 0 | 50000 | 2025-10-10T17:45:00Z | 2026-04-27T14:55:00Z |
| usgs/t6_census_lf_00060_p003.json.gz | 13013 | 0 | 0 | 0 | 0 | 13013 | 2026-04-27T15:00:00Z | 2026-06-11T23:55:00Z |
| usgs/t1_por_00060_p001.json.gz | 47064 | 0 | 0 | 0 | 0 | 47064 | 2026-06-12T00:00:00Z | 2026-11-22T09:55:00Z |
| usgs/t2_lf_00060_p001.json.gz | 47030 | 0 | 2 | 0 | 0 | 47030 | 2026-06-12T00:00:00Z | 2026-11-22T10:00:00Z |

## Appendix B. Series inventory of the readings tables (rows, first, last, blank values, most common steps in minutes)

### readings_old_archive

| gauge/param | rows | first utc | last utc | blank | steps (minutes: count) |
|---|---|---|---|---|---|
| 01638500/00010 | 42905 | 2026-06-11T23:00:00Z | 2026-11-09T23:55:00Z | 1 | 5: 42900, 60: 1, 35: 1, 15: 1, 2885: 1 |
| 01638500/00060 | 43500 | 2026-06-11T23:00:00Z | 2026-11-09T23:55:00Z | 0 | 5: 43499 |
| 01643000/00060 | 14500 | 2026-06-11T23:00:00Z | 2026-11-09T23:45:00Z | 0 | 15: 14499 |
| 01644000/00060 | 14500 | 2026-06-11T23:00:00Z | 2026-11-09T23:45:00Z | 0 | 15: 14499 |
| 01644148/00065 | 14496 | 2026-06-11T23:00:00Z | 2026-11-09T23:45:00Z | 0 | 15: 14494, 75: 1 |
| 01644280/00060 | 43308 | 2026-06-11T23:00:00Z | 2026-11-09T23:55:00Z | 0 | 5: 43306, 965: 1 |
| 01645000/00060 | 43500 | 2026-06-11T23:00:00Z | 2026-11-09T23:55:00Z | 0 | 5: 43499 |
| 01646500/00060 | 43469 | 2026-06-11T23:00:00Z | 2026-11-09T23:55:00Z | 2 | 5: 43454, 10: 8, 15: 3, 25: 2, 50: 1 |
| 01646500/00065 | 43481 | 2026-06-11T23:00:00Z | 2026-11-09T23:55:00Z | 2 | 5: 43475, 10: 2, 25: 2, 50: 1 |

### readings_old_octpull

| gauge/param | rows | first utc | last utc | blank | steps (minutes: count) |
|---|---|---|---|---|---|
| 01638500/00010 | 4897 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 5: 4896 |
| 01638500/00060 | 4897 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 5: 4896 |
| 01638500/00065 | 4897 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 5: 4896 |
| 01643000/00060 | 1633 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 15: 1632 |
| 01643000/00065 | 1633 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 15: 1632 |
| 01644000/00060 | 1633 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 15: 1632 |
| 01644000/00065 | 1633 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 15: 1632 |
| 01644148/00065 | 1633 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 15: 1632 |
| 01644280/00060 | 4897 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 5: 4896 |
| 01644280/00065 | 4897 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 5: 4896 |
| 01645000/00060 | 4897 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 5: 4896 |
| 01645000/00065 | 4897 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 5: 4896 |
| 01646500/00010 | 4897 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 5: 4896 |
| 01646500/00060 | 4897 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 5: 4896 |
| 01646500/00065 | 4897 | 2026-10-04T23:00:00Z | 2026-10-21T23:00:00Z | 0 | 5: 4896 |

### readings_current_model

| gauge/param | rows | first utc | last utc | blank | steps (minutes: count) |
|---|---|---|---|---|---|
| 01638500/00010 | 46469 | 2026-06-12T00:00:00Z | 2026-11-22T09:55:00Z | 1 | 5: 46464, 60: 1, 35: 1, 15: 1, 2885: 1 |
| 01638500/00060 | 47064 | 2026-06-12T00:00:00Z | 2026-11-22T09:55:00Z | 0 | 5: 47063 |
| 01638500/00065 | 47064 | 2026-06-12T00:00:00Z | 2026-11-22T09:55:00Z | 0 | 5: 47063 |
| 01643000/00060 | 15689 | 2026-06-12T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 15688 |
| 01644000/00060 | 15688 | 2026-06-12T00:00:00Z | 2026-11-22T09:45:00Z | 0 | 15: 15687 |
| 01644148/00065 | 15689 | 2026-06-12T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 15688 |
| 01644280/00060 | 47065 | 2026-06-12T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 5: 47064 |
| 01645000/00060 | 47065 | 2026-06-12T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 5: 47064 |
| 01646500/00060 | 47030 | 2026-06-12T00:00:00Z | 2026-11-22T10:00:00Z | 2 | 5: 47014, 10: 8, 15: 3, 25: 3, 50: 1 |
| 01646500/00065 | 47042 | 2026-06-12T00:00:00Z | 2026-11-22T10:00:00Z | 2 | 5: 47035, 25: 3, 10: 2, 50: 1 |

### readings_current_upstream

| gauge/param | rows | first utc | last utc | blank | steps (minutes: count) |
|---|---|---|---|---|---|
| 01610000/00060 | 7905 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7897, 30: 6, 45: 1 |
| 01610000/00065 | 7905 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7897, 30: 6, 45: 1 |
| 01613000/00060 | 7913 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7912 |
| 01613000/00065 | 7913 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7912 |
| 01614500/00060 | 7913 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7912 |
| 01614500/00065 | 7913 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7912 |
| 01616500/00060 | 7913 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7912 |
| 01616500/00065 | 7913 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7912 |
| 01618000/00060 | 7913 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7912 |
| 01618000/00065 | 7913 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7912 |
| 01619500/00060 | 7913 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7912 |
| 01619500/00065 | 7913 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7912 |
| 01636500/00060 | 7913 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7912 |
| 01636500/00065 | 7913 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7912 |
| 01637500/00060 | 7767 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7744, 120: 20, 30: 1, 90: 1 |
| 01637500/00065 | 7748 | 2026-09-01T00:00:00Z | 2026-11-22T10:00:00Z | 0 | 15: 7745, 30: 1, 2475: 1 |

### readings_current_census

| gauge/param | rows | first utc | last utc | blank | steps (minutes: count) |
|---|---|---|---|---|---|
| 01638500/00060 | 110999 | 2024-11-22T10:00:00Z | 2026-11-22T09:55:00Z | 0 | 5: 67895, 15: 42857, 240: 140, 360: 94, 30: 5 |
| 01646500/00060 | 160043 | 2024-11-22T10:00:00Z | 2026-11-22T10:00:00Z | 2 | 5: 140014, 15: 18960, 10: 330, 30: 320, 240: 135 |


## Fix round (2026-11-23): commission withdrawal table, dictionary corrections

Added after the tool audit (findings 6, 7, 10). No network, no database, no old-versus-current river comparison.

### Step 6. tools/06_parse_coop_reports.py -> data/tidy/withdrawals_coop.csv

- In: 50 saved report pages `research/data/coop/node797.html` .. `node846.html` (listing pages `list_p0..p10.html` are not parsed, only hashed into the manifest). Out: **50 rows, 29 columns** (one row per page; 50 distinct report dates, 2026-01-05 to 2026-11-20). Plus `withdrawals_coop_summary.json` (counts) and `withdrawals_coop_vs_researcher.json` (comparison). Nothing converted or computed; values are the printed numbers.
- Report date: from the page title "(Weekday, DATE)". Withdrawal date: the date in "Yesterday's ... withdrawals and discharges (DATE)". The previous-day gauge and commission-flow values are taken from the line whose printed date equals the withdrawal date (the report-day "est., based on recently available real-time data" lines are not used).
- Blanks (value not printed as a number; each page line was present): WSSC Potomac withdrawal 4 (nodes 836, 837 "Not available"; 838, 839 "Not Available"), total Potomac withdrawal 4 and total net Potomac withdrawal 4 (same pages); Little Falls previous-day cfs 1, Point of Rocks previous-day cfs 3, commission flow (MGD and cfs) 1 each, all "Not available due to ice" (nodes 822, 823, 824). 0 lines missing from any page. In the flag column of such a blank the printed "Not available ..." text is stored.
- Flags (non-blank marker on a present value): Washington Aqueduct Great Falls "(estimate)" 1 (node 810); Point of Rocks previous-day "*" 1 (node 825, asterisk after the date); Little Falls previous-day "*" 1 and commission flow "*" 1 (node 836, asterisk after the cfs value). Plus the 5 "Not available ..." texts in flag columns (LF 1, PoR 3, commission flow 1) and 12 in the withdrawal flag columns of nodes 836 to 839 (WSSC, total, total net: 3 columns x 4 pages). Special Conditions text: 50 rows: 45 with text, 5 where the page says "None", 0 blank (nodes 828 and 829 have the heading in its own paragraph with the text in the next one, node 801 a plain-paragraph heading; all three are parsed).
- Manifest: all 50 report pages and 11 listing pages (61 files) added to `data/MANIFEST.json` with path, bytes, SHA-256, address from `research/data/README.md` and the retrieval time as recorded there (a time range: reports 10:58 to 11:00 UTC, listings 10:56 to 10:58 UTC on 2026-11-22; per-file times are not recorded). The merge lives in `tools/coop_common.py`, called by 06 and by 03, so a rerun of 03 keeps the entries. Manifest now 146 files, all hashes re-verified.

### Step 7. tools/07_compare_coop_csv.py: my table against the researcher's CSV

800 cells compared (50 rows x 16 shared columns: node, report_date, withdrawal_date, source_url, the 8 withdrawals, wash_aqueduct_great_falls_flag, lf_prev_day_cfs, por_prev_day_cfs, coop_flow_below_gf_intake_mgd = great_falls_est_MGD). 14 differences, researcher's files untouched:

| node | column | mine | researcher's CSV |
|---|---|---|---|
| 810 | wash_aqueduct_great_falls_flag | `(estimate)` | `estimate` (brackets stripped) |
| 825 | por_prev_day_cfs | 1727 (page: "Point of Rocks flow 2026-01-22*: 1117 MGD (1727 cfs)") | blank |
| 836, 837 | wssc_potomac, total_potomac_withdrawal, total_net (6 cells) | blank | `Not available` |
| 838, 839 | same three columns (6 cells) | blank | `Not Available` |

Not in the researcher's CSV at all (columns of mine only): every other flag column (node 825 and 836 asterisks), `coop_flow_below_gf_intake_cfs`, `special_conditions_text`; the report-day estimated values are in neither table.

### Dictionary corrections (tools/dictionary.py, regenerated into data/tidy/DICTIONARY.md by 03)

- New section for withdrawals_coop.csv: the two gauge columns are the commission's snapshot of USGS provisional values on the report day (a vintage), not USGS's current record; `coop_flow_below_gf_intake_*` is the commission's quantity (Little Falls flow plus the Little Falls withdrawal), not the app's Great Falls estimate.
- bins.csv, gf_correction_bin rows: `snapshot_time_utc` is the export time and `row_created_utc` the row's creation time (months old, row updated in place); neither is the time the bin last learned; use the snapshot rows and binBefore/binAfter in checks.csv.
- `seq`: runs.csv by `at`; checks.csv by `created_at` (checks have no `at`). Verified for the 20 checks: created_at order equals valAt order, so the build's sort (valAt, then created_at) gives the same `seq`.

### Rerun and unchanged-table check

03 was edited (manifest merge call only) and rerun, plus 05 (all 12 counts equal, 54 traces ok). SHA-256 of every pre-existing tidy file before and after: identical for bins, checks, field_measurements, the five readings tables, runs, runs_tails, sites, state_other.json and RECONCILE.json. Changed, as intended: DICTIONARY.md, BUILD_REPORT.json (only `manifest_files` 85 to 146) and data/MANIFEST.json (+61 entries). `tools/06` and `07` rerun afterwards give identical outputs.

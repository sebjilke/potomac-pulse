# How USGS revises provisional flow data

Compiled 2026-11-22. Raw copies in data/usgs_pages/ and data/pdf/. USGS web hosts often return HTTP 403 to automated requests; pages below are the ones I could read. Labels: (a) stated by source, (b) my inference, (c) not found.

## 1. Provisional means revisable (a)

USGS Provisional Data Statement, https://water.usgs.gov/data/provisional.html (copy data/usgs_pages/water.usgs.gov_data_provisional.html.html, retrieved 2026-11-22 ~11:00 UTC):

- "Data are provisional and subject to revision until they have been thoroughly reviewed and received final approval."
- "Provisional data may be inaccurate due to instrument malfunctions or physical changes at the measurement site."
- "Subsequent review based on field inspections and measurements may result in significant revisions to the data."

## 2. Rating curves and shifts (a)

USGS FAQ "How is a rating curve used to convert gage height into streamflow?", https://www.usgs.gov/faqs/what-rating-curve-why-does-it-change-over-time (copy data/usgs_pages/www.usgs.gov_faqs_what-rating-curve-why-does-it-change-over-time.html):

- "This stage-discharge relationship is called a rating curve. It's developed by making frequent manual discrete discharge measurements at stream gaging stations."
- "The rating curve depends on the physical characteristics of the stream channel and floodplain, and will vary over time at almost every station."
- "There are often subtle changes to a natural stream channel, such as the growth of aquatic vegetation in the summer, frequent shifting of a sand-bed stream bottom, catastrophic changes due to floods, or man-made changes such as construction of a bridge. These changes might require only minor or temporary adjustments to the rating curve, or they could require the development of a new one."

USGS Wyoming-Montana Water Science Center, "Shift-Adjusted Ratings" (23 Sep 2020), https://www.usgs.gov/centers/wy-mt-water/science/shift-adjusted-ratings (copy data/usgs_pages/www.usgs.gov_centers_wy-mt-water_science_shift-adjusted-ratings.html). This is another state's office; it is a general explanation, not about Maryland:

- "Some measurements indicate a temporary change in the rating, often due to a change in the streambed (for example, erosion or deposition) or growth of riparian vegetation. Such changes are called shifts; they may indicate a short- or long-term change in the rating for the gage. In normal usage, the measured shifts (or corrections) are applied mathematically to a defined rating."
- "The shift adjustments are applied to the individual ratings as measured data becomes available, resulting in an adjusted rating. Some ratings may change as often as weekly, others may not change for months or years."
- "The stage-discharge rating provided in online files should be considered provisional and subject to change."

## 3. Debris, vegetation and backwater (partly unverified)

- Vegetation and streambed change: quoted in section 2 (a).
- Debris: a USGS FAQ lists "backwater from ice or debris such as log jams, algae and aquatic growth in the stream, sediment movement, malfunction of recording equipment" as things that can affect real-time streamflow data. I saw this sentence only in a search-tool summary of https://www.usgs.gov/faqs/why-might-usgs-streamflow-data-be-revised; the page itself returned 403, so the exact wording is NOT verified. Do not quote it without checking.
- USGS Water Data blog on the "Backwater" web flag (https://waterdata.usgs.gov/blog/webflags): search summary says it gives examples such as beaver dams, weeds or vegetation and that discharge "need[s] to be corrected". Not read; unverified.

## 4. How far back a revision can reach (a, with a gap)

USGS "Approval Guidance: Stage-Discharge Streamflow Records" (checklist; PDF metadata creation date 2017-08-28, no title in metadata; https://water.usgs.gov/osw/time-series-guidance/SW1_StageQ/Approval_Guidance_stageQ.pdf; copy data/pdf/USGS_Approval_Guidance_stageQ.pdf, retrieved 2026-11-22 ~11:27 UTC). Quotes:

- Item 9.1: "Does the timing of the application of the developed shift curves agree with the interpretation of the cause for the identified shift?" Item 9.2: "Has the timing of the application of shift curves been adequately explained with respect to the hydrograph?"
- Item 2.2 (levels): "If levels are overdue and the record is analyzed and then approved, revisions may be required as per established revision criteria."
- Item 2.4.6: "Does application of the correction extend into a period of previously approved data? If so, was the approved period evaluated in accordance with applicable revision criteria?"
- Item 7.2: "Does the active rating represent the current stage-discharge relation as indicated by documented control features and the plotting position of recent measurements made under clear control conditions?"

What this shows (b): shifts are applied over a stated time span chosen by the hydrographer to match the cause of the shift (for example a gradual build-up), which can reach back before the measurement that revealed it. The exact rule for how far back is not in the checklist. A "revision criteria" document is referred to but I did not find it (c).

Related from search summaries (not read; unverified): a USGS policy memo on timely correction of published data (https://water.usgs.gov/admin/memo/SW/sw1408.pdf; the page I fetched showed an empty table) and an NWIS availability statement saying "provisional data will be provided for only the most recent three years" (https://waterdata.usgs.gov/iv-data-availability-statement, 403 on fetch). Annual publication: "The data are usually published within 6 months of the end of the water year" appeared in a search summary of a USGS page; the page was not identified and not read.

Authoritative technique reports for later quoting (not read, tables of contents only seen in search results): Kennedy, TWRI 3-A13 "Computation of Continuous Records of Streamflow" (https://pubs.usgs.gov/twri/twri3-a13/html/toc.html), which includes sections "Shift adjustments varied with time only" and "Shift adjustments varied with time and stage". Search summary says a common practice is not to shift when a measurement is within 5 percent of the rating. Unverified.

## 5. Facts from the USGS data service about Point of Rocks (a)

API https://api.waterdata.usgs.gov/ogcapi/v1/collections/field-measurements/items?monitoring_location_id=USGS-01638500&time=2026-08-01/.. retrieved 2026-11-22 ~11:26 UTC (data/usgs_pages/field_meas_01638500_2026-08on.json). Field measurements at 01638500 since 1 Aug 2026 (discharge cfs, gage height ft; the table is "as returned", approval status as returned):

| Date | Discharge (cfs) | Gage height (ft) | Approval |
|---|---|---|---|
| 2026-08-12 | 2690 | 1.65 | Approved |
| 2026-09-03 | 1830 | 1.34 | Provisional |
| 2026-10-08 | 1510 | 1.20 | Provisional |
| 2026-11-10 | 1980 | 1.20 | Provisional |

All eight rows carry last_modified 2026-11-13 20:34 UTC. No measurement rating (Good, Fair, Poor) or shift field is returned by this collection (c). Note that the date and the approval label of the 12 Aug row are as returned; I did not check them further. The station page also shows "Field measurements ... data from 1895-03-25 to 2026-11-10" and "Daily data ... to 2026-11-21". The page says the station is "Operated in cooperation with: Interstate Commission on the Potomac River Basin" and, as of retrieval, displays a notice that bridge work obstructs the camera.

I found no official USGS notice about the 13 Nov 2026 revision of Point of Rocks (c).

## 6. Plain-language summary for a non-specialist (b, my wording of the quotes above)

USGS does not measure river flow directly each minute. It measures water level, then converts level to flow with a curve built from occasional hand measurements. When a new measurement shows the curve is off, for example because the channel changed or plants, debris or sediment altered the control, USGS applies a "shift" and the published flow numbers are recomputed, possibly from some earlier date. Data stay "provisional" and can be revised until a full review and approval.

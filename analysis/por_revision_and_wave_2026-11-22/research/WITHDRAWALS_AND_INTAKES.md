# Withdrawals and intakes, Point of Rocks to Little Falls

Compiled 2026-11-22 (retrieval times 10:55 to 11:30 UTC). Nothing here is analysis of river data. Labels: (a) stated by the source, (b) my inference, (c) not found.

## 1. Sources table

| Source | What it holds | Dates | Time step | Address | Status |
|---|---|---|---|---|---|
| ICPRB CO-OP Data Portal, "Daily Potomac flow and demand update" | Per-utility Potomac withdrawals (Fairfax Water Corbalis, WSSC Potomac, Washington Aqueduct Great Falls and Little Falls, Loudoun Water), Loudoun Broad Run discharge, totals, plus Little Falls and Point of Rocks flow, in MGD | Only on days daily monitoring is active. Autumn 2026 coverage listed in section 3 | Daily mean for the previous day | https://icprbcoop.org/products/monitoring-reports (one page per report, e.g. https://icprbcoop.org/node/846); feed https://icprbcoop.org/monitoring-reports.xml | RETRIEVED, 44 pages from Aug 2026 on, parsed to CSV |
| USGS 01646502 "Potomac River, adjusted, near Wash, DC" daily values | Little Falls flow with withdrawals added back (see 2.3) | Series ends 2025-12-31 as of retrieval | Daily | https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/items?f=json&monitoring_location_id=USGS-01646502 | RETRIEVED, but NO values for Sep to Nov 2026 |
| ICPRB Water Supply Outlook, monthly (Apr to Oct) | Probabilities of low flow, drought status, typical summer demand range | Oct 2026 edition dated 2026-10-08 | Monthly | https://www.potomacriver.org/wp-content/uploads/2026/10/WSO.Oct_.26.pdf | RETRIEVED. Not daily withdrawals |
| ICPRB 2025 Washington Metropolitan Area Water Supply Study | Annual and seasonal averages, supplier descriptions, return flows | Data through 2023 | Annual / seasonal | https://www.potomacriver.org/wp-content/uploads/2025/12/2025_WMA_Water_Supply_Study_ICPRB_Dec-2025.pdf | RETRIEVED. Typical figures only, not 2026 |
| Utilities' own daily or hourly data (Washington Aqueduct, WSSC Water, Fairfax Water, Loudoun Water, Leesburg, Rockville) | Not searched at utility sites beyond web search | | | | NOT FOUND publicly. Per the CO-OP reports, suppliers send data to ICPRB by email (coop@icprb.org) for automated processing |
| Hourly or sub-daily withdrawals | | | | | NOT FOUND |
| Rockville and Leesburg withdrawals for 2026 | | | | | NOT FOUND (they are not in the CO-OP report lines) |

Answer to "daily or hourly": daily exists (CO-OP). Hourly was not found.

Was the low-flow threshold crossed in 2026? Yes, stated by the source. The CO-OP reports say "Potomac River flow at Point of Rocks has dropped below the low-flow threshold of 2,000 cfs" (in 37 of the 50 fetched pages) and the Oct 2026 outlook says "On October 5, CO-OP initiated daily drought monitoring because flows at the Point of Rocks monitoring gage fell below 2,000 cubic feet per second". A news item (https://www.potomacriver.org/news/icprb-initiates-drought-monitoring-august-3-2026/) says daily monitoring began 3 Aug 2026 at 1,740 cfs. The Oct outlook says "A Drought Watch for the metropolitan Washington region remains in effect" and "At present, Potomac River flow is sufficient to meet metropolitan area water demands without upstream reservoir augmentation". Drought Operations (twice-daily reports, release recommendations): not found in 2026 for this period.

## 2. What the CO-OP report says (quoted)

From https://icprbcoop.org/node/846 (report for Fri 2026-11-20, retrieved 2026-11-22 10:56 UTC):

- "Note: Gage flow at Little Falls is measured after water supply withdrawals."
- "Note: Estimated flow below Great Falls intake is flow at Little Falls plus Little Falls water supply withdrawal."
- Lines carried each day: "Fairfax Water Corbalis withdrawal - Potomac", "WSSC Water Potomac withdrawal", "Washington Aqueduct withdrawal - Great Falls", "Washington Aqueduct withdrawal - Little Falls", "Loudoun Water withdrawal", "Loudoun Water Broad Run discharge", "Total Potomac withdrawal", "Total net Potomac withdrawal". Units are MGD (million gallons per day). My conversion: 1 MGD = 1.547 cfs.
- Special Conditions line in most reports: "Intra-daily flow fluctuations associated with upstream dam operations for eel passage may continue to affect observed flows at Point of Rocks and other Potomac River gages." (Oct reports: "...are occurring due to upstream dam operations associated with eel passage.")
- The reports also give Point of Rocks and Little Falls gauge flow for the previous day and an estimate for the report day. These are as published on the report day, so they are a snapshot of USGS provisional values at that time (b: a vintage record that could be compared with later USGS values; not checked here).

Limits (a) and (c): the reports cover only five utilities' lines (Fairfax Corbalis, WSSC Potomac, Washington Aqueduct x2, Loudoun). Rockville and Leesburg are not listed. Four reports (Nov 8, 9, 11, 12; withdrawal dates Nov 7, 8, 10, 11) show "Not available" for WSSC and totals. The Oct 5 report marks Washington Aqueduct Great Falls as "(estimate)". The Nov 8 report notes a Little Falls value "estimated after removal of anomalous spike in USGS provisional data".

## 3. The autumn 2026 table (MGD), exactly as parsed from the pages

Full parsed file: data/coop/coop_daily_reports_parsed.csv (raw HTML of every page in data/coop/). Parsed by a regular expression; spot-checked against pages 810, 812, 836, 846 by reading the text. "Not available" is the source's wording.

Days with a report (withdrawal date): 14 to 23 Sep; 4 to 11 Oct; 29 Oct to 5 Nov; 7, 8, 10, 11 Nov; 12 Nov; 14 to 19 Nov. Days with NO report in Sep to Nov: 1 to 13 Sep, 24 Sep to 3 Oct, 12 to 28 Oct, 6, 9 and 13 Nov (withdrawal dates 6, 9, 13 Nov are not covered), and 20 Nov on. (b) The gaps match days when Point of Rocks was at or above 2,000 cfs, the stated trigger, but I did not test that. The CSV also holds Jan, Feb and 3 to 9 Aug 2026 pages; the table below starts at 1 Sep as asked.

| Withdrawal date | Fairfax Corbalis | WSSC Potomac | Wash. Aqueduct Great Falls | Wash. Aqueduct Little Falls | Loudoun | Broad Run discharge | Total withdrawal | Net | Report (node) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-14 | 105 | 156 | 147 | 0 | 12 | 7 | 420 | 413 | 820 |
| 2026-09-15 | 109 | 147 | 133 | 0 | 12 | 7 | 401 | 394 | 819 |
| 2026-09-16 | 117 | 159 | 148 | 0 | 12 | 7 | 436 | 429 | 803 |
| 2026-09-17 | 115 | 162 | 142 | 0 | 12 | 7 | 430 | 423 | 804 |
| 2026-09-18 | 111 | 140 | 117 | 0 | 12 | 7 | 380 | 373 | 805 |
| 2026-09-19 | 107 | 134 | 119 | 0 | 12 | 7 | 372 | 365 | 806 |
| 2026-09-20 | 96 | 129 | 128 | 0 | 12 | 7 | 364 | 357 | 818 |
| 2026-09-21 | 98 | 149 | 129 | 13 | 12 | 8 | 401 | 393 | 807 |
| 2026-09-22 | 82 | 128 | 126 | 6 | 12 | 7 | 353 | 346 | 808 |
| 2026-09-23 | 99 | 145 | 129 | 0 | 11 | 8 | 384 | 376 | 817 |
| 2026-10-04 | 87 | 123 | 130 (est.) | 0 | 12 | 8 | 352 | 344 | 810 |
| 2026-10-05 | 93 | 147 | 97 | 26 | 12 | 7 | 375 | 368 | 809 |
| 2026-10-06 | 86 | 116 | 73 | 56 | 10 | 8 | 340 | 332 | 811 |
| 2026-10-07 | 99 | 130 | 61 | 75 | 12 | 7 | 377 | 370 | 816 |
| 2026-10-08 | 100 | 154 | 55 | 69 | 12 | 7 | 390 | 383 | 812 |
| 2026-10-09 | 104 | 155 | 35 | 88 | 7 | 8 | 389 | 381 | 815 |
| 2026-10-10 | 96 | 136 | 43 | 81 | 7 | 8 | 362 | 355 | 813 |
| 2026-10-11 | 87 | 127 | 56 | 62 | 7 | 8 | 339 | 330 | 814 |
| 2026-10-29 | 87 | 123 | 127 | 0 | 11 | 7 | 347 | 340 | 828 |
| 2026-10-30 | 87 | 129 | 123 | 0 | 11 | 7 | 350 | 342 | 829 |
| 2026-10-31 | 84 | 130 | 119 | 0 | 11 | 8 | 343 | 335 | 830 |
| 2026-11-01 | 80 | 168 | 116 | 0 | 11 | 8 | 375 | 367 | 831 |
| 2026-11-02 | 93 | 156 | 111 | 0 | 11 | 8 | 371 | 363 | 832 |
| 2026-11-03 | 86 | 156 | 116 | 0 | 11 | 7 | 369 | 361 | 833 |
| 2026-11-04 | 87 | 149 | 122 | 0 | 10 | 7 | 367 | 360 | 834 |
| 2026-11-05 | 75 | 127 | 117 | 0 | 10 | 7 | 328 | 321 | 835 |
| 2026-11-07 | 81 | Not available | 118 | 0 | 8 | 8 | Not available | Not available | 836 |
| 2026-11-08 | 88 | Not available | 109 | 0 | 8 | 8 | Not available | Not available | 837 |
| 2026-11-10 | 80 | Not Available | 110 | 0 | 8 | 7 | Not Available | Not Available | 838 |
| 2026-11-11 | 95 | Not Available | 114 | 0 | 8 | 7 | Not Available | Not Available | 839 |
| 2026-11-12 | 88 | 117 | 112 | 0 | 7 | 7 | 323 | 316 | 840 |
| 2026-11-14 | 80 | 150 | 109 | 0 | 7 | 8 | 347 | 339 | 841 |
| 2026-11-15 | 90 | 166 | 111 | 0 | 7 | 8 | 374 | 366 | 842 |
| 2026-11-16 | 84 | 168 | 108 | 0 | 8 | 8 | 369 | 361 | 843 |
| 2026-11-17 | 85 | 181 | 117 | 0 | 10 | 8 | 393 | 385 | 844 |
| 2026-11-18 | 86 | 169 | 118 | 0 | 10 | 8 | 383 | 375 | 845 |
| 2026-11-19 | 77 | 159 | 124 | 0 | 10 | 8 | 370 | 362 | 846 |

Range of "Total Potomac withdrawal" where given (33 days): 323 to 436 MGD, which is about 500 to 675 cfs (my conversion). Washington Aqueduct drew from the Little Falls intake on 21 and 22 Sep and on 5 to 11 Oct (up to 88 MGD) and 0 otherwise; at the same time its Great Falls draw fell to 35 to 73 MGD (a, from the table). Context found: after a January 2026 sewer collapse the Little Falls intake was closed ("intakes at the Little Falls Pumping Station ceased operations immediately", per https://www.dvidshub.net/graphic/40807/..., a search-tool summary, not read in full).

## 4. USGS adjusted record 01646502

- Station record (monitoring-locations API, data/ml_01646502.json): name "POTOMAC RIVER, ADJUSTED, NEAR WASH, DC", drainage area 11,560 sq mi, same as Little Falls.
- Daily values (data/ts_meta_01646502.json): parameter 00060, mean, begin 1930-03-01, end 2025-12-31, metadata last modified 2026-11-22 04:56 UTC. Latest values returned are for 2025-12-31 (2790 cfs, Provisional). A request for 2026-08-01 onward returned zero features (data/daily_01646502_2026-08on.json). So (a/c): the adjusted record is not published for Sep to Nov 2026 as of 2026-11-22.
- Definition: not found in an official USGS page. Search-tool summaries of ICPRB reports say USGS added withdrawals back; unverified wording. ICPRB defines its own "natural flow" as "observed flow at the Little Falls gage plus total Washington metropolitan Potomac withdrawals, with an adjustment made to remove the effect of North Branch reservoir releases on stream flow" (Oct 2026 outlook, p.1). That is a different quantity from 01646502.
- The USGS page for 01646500 says Little Falls diversions: "Diversions at Great Falls through aqueducts since June 1959, from gage pool at Little Falls Dam; since October 1958, at Rockville Filtration Plant; since April 1961, at Potomac Filtration Plant; since October 1961, at Fairfax Water Treatment Plant (from Goose Creek); since April 1964, at Violets Lock to Chesapeake and Ohio Canal; and since October 1985, at Fairfax County Water Authority Treatment Plant." (https://natwebvaww01.er.usgs.gov/monitoring-location/01646500, retrieved 2026-11-22 ~11:01 UTC; saved data/usgs_pages/nat_01646500.txt). This is the USGS wording. (General knowledge, not verified here: Violettes Lock on the C&O Canal is upstream of Great Falls.)

Typical (not 2026) figures: ICPRB 2025 study: average production split "WSSC Water 33 percent (109 MGD), Fairfax Water 27 percent (89 MGD), Washington Aqueduct 40 percent (133 MGD)" (the period is 2019 to 2023 per the surrounding text, which I did not fully read); total WMA production incl. Rockville "459 MGD in 2023"; summer production 2019 to 2023 "averaged 501 MGD". Oct 2026 outlook: "Drinking water demand ranges from 400 to 700 MGD during the summer months". These are NOT 2026 daily values. (Note: Potomac-only withdrawals in the CO-OP lines, 323 to 436 MGD, are smaller than whole-region production because Fairfax Occoquan and WSSC Patuxent supply are separate. Inference.)

## 5. Where each intake and return sits

Strength of evidence is marked per line. River miles were not found in any source I could read; the 1981 Maryland DNR report has a map "Study Area Showing Intake Locations" (https://www.potomacriver.org/wp-content/uploads/2018/01/1981-Potomac-Env-Flows-Report_Complete.pdf, Figure 3-2) that is an image I could not read as text.

Anchors (a):
- Little Falls gauge 01646500: "On left bank just upstream from Little Falls Dam, 1 mi upstream from District of Columbia boundary line, 1.2 mi upstream from Chain Bridge ... and at mile 117.4." (USGS page; the mile reference point is not stated.)
- Great Falls "located about nine miles upstream of Little Falls Dam" (ICPRB 2025 study, section 5.2).
- "all WMA suppliers withdrawing water via intakes located in an approximately 18 mile stretch of the river upstream of Little Falls dam" (ICPRB 2020 study, section 2). The 2020 study also says the Little Falls gauge is "just downstream of WMA Potomac water supply intakes".
- Point of Rocks gauge: 39.2736 N, -77.5431 W, drainage area 9,651 sq mi (USGS). Little Falls: 11,560 sq mi.
- Resulting position (b, inference from the 18 mile and 9 mile statements): the Point of Rocks gauge is upstream of all the intakes below. I did not find a source giving the Point of Rocks to intake distance in miles.

| Item | Position as found | Evidence |
|---|---|---|
| Washington Aqueduct, Great Falls intake | "just above the falls, along the canal" at Great Falls (Maryland side); water goes about 12 miles by conduit to Dalecarlia and Georgetown reservoirs | NPS and NRHP text via search summary (https://www.nps.gov/places/washington-aqueduct.htm); ICPRB 2025 section 2.3.3: "an intake on the Potomac River at Great Falls" |
| Washington Aqueduct, Little Falls intake and pumping station | At Little Falls Dam, "about 2 miles above Chain Bridge", in the gauge pool; the gauge is on the left bank just upstream of the dam | ICPRB 2025 section 2.3.3; USGS REMARKS above; Wikipedia via search summary (weak) |
| Fairfax Water Corbalis intakes | Two Potomac intakes, "an onshore intake and a mid-river offshore intake"; plant at "the northern tip of Fairfax County" (Virginia shore) | ICPRB 2025 section 2.3.1 (a). Position relative to Great Falls: not found in a source I read |
| WSSC Water Potomac plant intake | Potomac WFP "adjacent to the Potomac River in Potomac, Maryland", capacity 280 MGD, in service since 1961 | ICPRB 2025 section 2.3.2 (a). Position relative to Great Falls: not found |
| City of Rockville intake | "an intake located just downstream of WSSC Water's intake" | ICPRB 2025 section 2.3 (a) |
| Loudoun Water Trap Rock intake | New Potomac intake (operating since 2018, "began operations in 2018"); raw water pumped about six miles to the plant at Gant Lane, Leesburg | ICPRB 2025 section 2.3.4; WTOP 2019 via search summary (https://wtop.com/loudoun-county/2019/05/drink-up-loudoun-co-now-treating-water-from-potomac-river/). Not read in full. Position not found |
| Town of Leesburg Rollins plant | Source water is the Potomac; 12.5 MGD rated, built 1982 | Leesburg pages via search summary (https://www.leesburgva.gov/departments/utilities-water-and-sewer/about-us). Intake position not found. Leesburg is not in the CO-OP report lines |
| Loudoun Water Goose Creek intake | Goose Creek, out of service as primary source, emergency use only (permit modified 2020) | ICPRB 2025 section 2.3.4 (a) |
| Seneca WRRF (WSSC) return | Treated wastewater, 15.95 MGD (2025 projected annual), to the Potomac River or its tributaries; discharges "upstream of the region's water supply intakes" is said of the group "several other facilities" | ICPRB 2025 section 5.5 and Table 5-2 (a). Exact outfall not found |
| Damascus WRRF (WSSC) return | 0.85 MGD | same |
| Loudoun Broad Run WRF return | 8 MGD (2025); CO-OP reports show 6 to 8 MGD for autumn 2026 | same; CO-OP pages |
| UOSA return | Goes to Occoquan Reservoir, not the Potomac above Little Falls | ICPRB 2025 section 5.5 (a) |
| Blue Plains (DC Water) treated discharge | Potomac estuary "south of Washington, DC", below Little Falls | ICPRB 2025 section 5.5 (a) |

Sentences of the form you asked for:

1. (a, from CO-OP wording) CO-OP defines "estimated flow below Great Falls intake" as "flow at Little Falls plus Little Falls water supply withdrawal". So in CO-OP's accounting the flow below the Great Falls intake already excludes the Fairfax Corbalis, WSSC Potomac, Loudoun and Washington Aqueduct Great Falls draws, and still includes whatever enters below Great Falls.
2. (a) The Little Falls gauge "is measured after water supply withdrawals". By the CO-OP note, the gauge reads the river after the Great Falls and Little Falls aqueduct intakes and the other listed intakes, so it is lower than the "adjusted" river by the total of those draws.
3. (b, inference, because positions of the Fairfax, WSSC, Loudoun and Rockville intakes relative to the Great Falls intake were not found in a source I read) CO-OP's definition implies those four intakes are at or above the Great Falls intake, and the 18-mile and 9-mile statements put them upstream of Little Falls Dam. Treat as likely, not proven. General knowledge I did not verify: WSSC, Rockville, Fairfax Corbalis and Loudoun intakes are upstream of Great Falls. 
4. (a) Seneca, Damascus and Broad Run treated water returns enter "upstream of the region's water supply intakes" (ICPRB wording for the group); so the flow over Great Falls includes those returns net of the withdrawals above it. Blue Plains does not return above Little Falls.
5. (a) The Point of Rocks gauge (drainage area 9,651 sq mi) is upstream of everything in this table (b, from the 18-mile statement). Tributaries between Point of Rocks and Little Falls (Monocacy, Goose Creek, Seneca Creek and others) are not part of this document; the ICPRB flow model uses "the USGS's Point of Rocks and Monocacy gages" with "a constant lag time of 2.3 days" to Little Falls Dam (2025 study, section 5).

## 6. Not found, to avoid guessing

- River-mile table for intakes and outfalls (only the unreadable 1981 map).
- Hourly or sub-daily withdrawals from any utility.
- Rockville and Leesburg daily Potomac withdrawals.
- An official USGS definition of 01646502.
- Position of Fairfax, WSSC, Loudoun, Rockville intakes relative to Great Falls in readable text.

# Data files: addresses and retrieval times (all 2026-11-22, UTC)

All fetched by plain HTTP requests or the web-fetch tool; none altered, except the derived CSV and .txt text extractions.

| Path | Address | Retrieved |
|---|---|---|
| coop/list_p0.html .. list_p10.html | https://icprbcoop.org/products/monitoring-reports?page=N | 10:56 to 10:58 |
| coop/node797.html .. node846.html (50 reports) | https://icprbcoop.org/node/N | 10:58 to 11:00 |
| coop/coop_daily_reports_parsed.csv | derived by regular expression from the node pages (my parsing; check against the pages) | 11:03 |
| coop/node_date_map.json | derived from list pages (listing pages beyond page 10 not fetched) | 10:58 |
| ml_*.json (6 sites) | https://api.waterdata.usgs.gov/ogcapi/v1/collections/monitoring-locations/items?f=json&id=USGS-SITE | 10:55 |
| daily_01646502_2026-08on.json (zero features) | .../collections/daily/items?f=json&monitoring_location_id=USGS-01646502&time=2026-08-01/..&limit=300 | 11:00 |
| ts_meta_01646502.json | .../collections/time-series-metadata/items?f=json&monitoring_location_id=USGS-01646502&limit=20 | 11:01 |
| usgs_pages/field_meas_01638500_2026-08on.json | .../collections/field-measurements/items?f=json&monitoring_location_id=USGS-01638500&time=2026-08-01/..&limit=50 | 11:26 |
| usgs_pages/nat_SITE.html and .txt | https://natwebvaww01.er.usgs.gov/monitoring-location/SITE (01638500, 01618000, 01636500, 01613000, 01646500) | 11:01 |
| usgs_pages/water.usgs.gov_data_provisional.html.html and the other USGS html | URLs in USGS_REVISIONS_BACKGROUND.md. The file www.usgs.gov_faqs_why-might-usgs-streamflow-data-be-revised.html and faq_why_revised.html are 403 error pages, kept as evidence of the block | 11:00 to 11:26 |
| wave_pages/*.html | ICPRB news items and the USGS eel paper page, addresses in WAVE_SOURCES.md | 11:05 |
| pdf/FR_2026-03575_dam4_dam5_variance.pdf | https://public-inspection.federalregister.gov/2026-03575.pdf | ~11:07 |
| pdf/FERC_P-2343_Millville_EA_2020.pdf | https://www.ferc.gov/sites/default/files/2020-06/P-2343EA.pdf | ~11:07 |
| pdf/ICPRB_2025_WMA_study.pdf, ICPRB_2020_WMA_study.pdf (+ .txt extractions) | potomacriver.org upload URLs in WITHDRAWALS_AND_INTAKES.md | 11:20 |
| pdf/ICPRB03-6_2002drought.pdf, MDDNR_1981_env_flows.pdf (+ .txt) | https://www.potomacriver.org/wp-content/uploads/2014/12/ICPRB03-6.pdf and .../2018/01/1981-Potomac-Env-Flows-Report_Complete.pdf | 11:24 |
| pdf/ICPRB_WSO_Oct_2026.pdf | https://www.potomacriver.org/wp-content/uploads/2026/10/WSO.Oct_.26.pdf | 11:27 |
| pdf/USGS_Approval_Guidance_stageQ.pdf | https://water.usgs.gov/osw/time-series-guidance/SW1_StageQ/Approval_Guidance_stageQ.pdf | ~11:27 |

The .txt files were produced from the PDFs with Ghostscript text extraction; spacing is approximate.

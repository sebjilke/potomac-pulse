# Independent plan audit: USGS service move

Auditor: a fresh subagent (Opus) that did not write the plan, read-only, 2026-11-17. Text extracted by script from the auditor's final report, not retyped.

## Audit: usgs-service-move-plan-2026-11-17.md

I made 4 requests to the new service and 3 to the old one. I did not change any file.

### Findings

1. **BLOCKER: the plan names the ice marking question but has no answer.** I checked it on gauges that are iced right now in Alaska. The old service returns `value "-999999"` with qualifiers `['P','Ice']` or `['P','Eqp']` (sites 15515500 and 15356000). The new service returns `value: null` with `qualifier ['ICE']` or `['EQUIP']`. Its qualifier is `null` on normal rows, and "provisional" has moved to `approval_status`. If null is passed through, `parseFloat(null)` gives NaN, so `val <= -999999` is false and every ice check stops firing.
   - Recommendation: the adapter needs an explicit mapping table: null → `"-999999"`, ICE → `Ice`, EQUIP → `Eqp`, and the same for the other codes (Ssn, Mnt, Dis…). Add `'P'` from `approval_status`. Test it against a saved fixture from these Alaska gauges, because no Potomac gauge is iced now.

2. **BLOCKER: "reproduce Ice exactly as the parsers expect" is contradictory.** The server reads `latest.qualifiers?.map(q => q.qualifierCode)` (scheduled-update.js:270), which expects objects. The client reads `qualifiers.includes('Ice')` (fetch.js:196), which expects strings. The real old service sends strings (fixture header; scheduled-update.js:2519), so the server's Ice-qualifier check has never worked. Only the -999999 sentinel catches ice on the server today.
   - Recommendation: the adapter emits strings, exactly as the old service did. Propose the server bug as a separate change; do not silently "fix" it inside the adapter.

3. **MAJOR: the call-site list is incomplete.**
   - Missed: `netlify/functions/build-ef-correlation-advanced.js:307-308` (`nwis.waterservices.usgs.gov`).
   - Missed: 7 test files that pin the old address. `test/truth-dr-handler.test.js:24,188` asserts the main URL byte for byte, so "1,425 tests unchanged" is false for Step 1. Also `data-freshness`, `clean-screen-behaviour`, `startup-refresh-behaviour`, `forecast-accuracy-row` and `sw-runtime-caching`.
   - Missed: the service worker host regex and the P7D/parameter rule (runtime-caching.mjs:39-54).
   - Missed: the CSP lists the relays (netlify.toml:27).
   - The plan does name `edwards-ferry.js` (both fetches), the creeks request and the relays.

4. **MAJOR: the adapter's grouping and ordering are unspecified.** Rows come grouped by `time_series_id`, not sorted by time across gauges (verified). Several series can exist per site and parameter (`statistic_id`, `method_category`). The parsers read `values[0]` and take the last element as "latest".
   - Recommendation: sort ascending by time within each series, and define which series becomes `values[0]`.
   - Detect `links rel="next"` and fail loudly on paging. A silent truncation would drop whole gauges.
   - When a site returns no rows, the old service may still have listed the series and the new one won't. Pin that down in the parity test.

5. **MINOR: 5-minute readings are not a behaviour change.** The old service already returns 5-minute data for Point of Rocks, Broad Run, Seneca and Little Falls (verified: 13, 10, 12 and 12 values in 1 h; Monocacy 15 min). The assumptions `values.length - 9` and `i += 4` in `fetchCreekData` and the Edwards Ferry `len - 5` are already wrong today for any creek gauge on 5 minutes; Difficult Run is on 15 minutes in the fixture. Note this as a known pre-existing issue, out of scope. Time zones are safe: the new service sends `+00:00` instead of `-05:00`, and every `dateTime` read goes through `Date.parse` or `new Date` except one log line.

6. **MAJOR: the parity test design will be flaky.**
   - The two calls happen at different moments, so a new batch can land between them.
   - `period=P2D` and `time=P2D` have different window edges.
   - Revised readings change values.
   - The old service is currently dropping 2 of 4 requests.
   - `npm test` gates deploys (netlify.toml:14), so a live parity test would block deploys and die on 2027-02-22.
   - Recommendation: compare saved fixtures for the same fixed past window (old: `startDT`/`endDT`; new: an explicit `time=a/b`). Compare values on matching timestamps and report timestamps found on one side only. Run no network calls in CI.

7. **MAJOR: the time budget and 429 handling are undefined.**
   - The new service takes about 2 s; the old one 6.6 to 30 s. If Netlify really starts a second attempt about 11 s in, an old-service fallback cannot fit. Cap it by the time left in the run, or drop it.
   - 429 is unhandled. The new service sits behind api-umbrella (header seen), and keyless limits are per IP. Netlify's AWS outbound addresses are shared with other customers, so keyless server calls are unpredictable and the key is required, not optional.
   - Recommendation: on 429, do not retry the new service; log `src:new_429`; after February, send the fail signal.
   - The double runs need a run lock (claim the hour) regardless of which service is used. Step 0 only reports them.

8. **MAJOR: Option C clashes with the freshness logic.**
   - `bodyTimeMs` treats a body older than 10 minutes as a saved copy (data-freshness.js:80). An edge-cache window plus any service worker caching must stay well under 10 minutes, or live answers show "Saved copy" and push the app to call USGS directly, which defeats the shared cache. `requestDT` must be the upstream `timeStamp`, not the function's own time.
   - Netlify caches function responses only with `Netlify-CDN-Cache-Control`/`s-maxage`, and per edge node unless `durable` is set. "One request serves all visitors" overstates it.
   - Cache-busting with extra query parameters makes every request a function call that spends the key's quota. Use `Netlify-Vary: query=name` and reject unknown parameters.
   - `/api/usgs` matches no service-worker rule, so it gets no timeout fallback. Add a NetworkFirst rule with a timeout below the page's.
   - The old-format body is about 2.9 MB (CHANGELOG), which fits under the 6 MB function response limit only if built compactly.

9. **MINOR: the publish-rhythm inference.** `last_modified` is the time the new database ingested the row. A revision restamps it, and it need not match when the old service had the data. My probe agreed with the table: Little Falls batch at :57, Point of Rocks at :02. Two days is thin. Gather two weeks of logs before Step 3, as planned.

10. **MAJOR: verification gaps.**
    - "Three clean runs" never exercises the fallback, 429 or ice paths. Ice cannot be checked live on the Potomac until it freezes: state it as an unverified gap.
    - "Estimate in line" needs a number, for example within X% of the previous hour, or a side-by-side from both services.
    - Step 2: CLAUDE.md requires a browser check with Chrome MCP, and the plan concedes there is none. The owner's phone check is a manual, unverified gap.
    - Hours of new-service data are written to the shared Point of Rocks history, with no record of which rows came from which source.

11. **MINOR: CLAUDE.md items.**
    - Step 1 must bump `SERVER_VERSION` (now v39.6).
    - The browser and server adapters are a new client/server pair; add them to CLAUDE.md's sync list.
    - `fetchDifficultRun` has a 2 s cap that the new service may miss often. It is logging only, but say so.

### Verdict

**Step 0** can start, but its ice question is already answered (findings 1 and 2). Replace it with: a mapping-table spec, an Alaska ice fixture, a decision on the run lock, and the 429 policy.

**Step 1** must not start as written. It first needs:
- the adapter spec for sorting, series choice, paging and missing series;
- fixture-only parity;
- a time budget that drops or caps the old-service fallback;
- 429 handling;
- the key (required, because of shared outbound addresses);
- an honest list of the tests that must change.

**Not checked:** the exact rate limits (no `X-RateLimit` headers in keyless answers); Netlify's retry behaviour (the plan's own observation); how the new service marks Ssn, Mnt and Dis codes; Option C caching on a real deploy.

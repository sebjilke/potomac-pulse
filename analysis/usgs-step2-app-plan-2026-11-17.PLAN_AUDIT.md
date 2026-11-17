# Independent plan audit: Step 2 (the app reads USGS through /api/usgs)

Auditor: a fresh subagent (Opus) that did not write the plan, read-only, 2026-11-17. Text extracted by script from the auditor's final report, not retyped.

## Step 2 plan audit (`analysis/usgs-step2-app-plan-2026-11-17.md`)

**Verdict:** the build can start once the five MAJOR items are written into the plan. None of them reopens the architecture, and each is a small change to the spec. My view of the inventory: the old-host and relay list is complete, but the test list is incomplete (finding 6).

### Findings

**1. MAJOR: a hostile client can get round the cache and spend the key.**
- The plan validates the decoded `multiValueQueryStringParameters`, but Netlify builds the cache key from the raw request.
- If the key uses the raw text, encoded or case variants all pass validation as different keys: `%73et=main`, `set=%6Dain`, `%6d` versus `%6D`. That is hundreds of upstream calls per 120 s.
- The function is also reachable at `/.netlify/functions/usgs-proxy?...`, outside the rewrite, which is a second set of keys. `/api/usgs/` with a trailing slash may be a third.
- HEAD on a cache miss calls USGS and returns no body.
- Recommendation:
  - Accept only a raw query string exactly equal to `set=main`, `set=creeks`, `set=ef` or `set=temp`, and an exact path. Reject everything else with 400 `no-store`.
  - Return 405 for HEAD.
  - Add these variants to tests 2 and 9 and to the curl checks in section 9.

**2. MAJOR: caching errors for 15 s is missing from the budget, and it can starve the hourly job.**
- A 502 or 504 kept 15 s refills 4 keys × 240 = 960 upstream calls an hour per edge. Errors carry no `durable`, so this counts per edge.
- That is exactly the "USGS is slow" case, and the hourly job shares the 1,000-per-hour key. The job would then hit 429 and the alert emails would come back.
- An upstream 429 is mapped to `Retry-After` up to 300 s but cached only 15 s.
- Recommendation:
  - Cache the 429-derived 503 at the edge for min(Retry-After, 300) s.
  - Cache 5xx and 504 for at least 60 s, with `durable`.
  - Redo the arithmetic in section 2 with these error refills included.

**3. MAJOR: the time limits do not fit together.**
- The main cap of 4.5 s covers only the upstream request and body read. Cold start, the conversion, building the output text and the trip to the edge come on top.
- The function's headers therefore arrive at about 5 s or later, after the service worker's 5 s timeout and close to the page's 6 s timer.
- On a first visit (no saved copy) the page aborts at 6 s and moves to stage 2, even though the function was about to answer.
- Recommendation: cap the whole function at about 3.5 s, or raise the timers to service worker 6 s and page 7 s. Add a test of the form cap + 1 s < service worker timeout < page timer.
- The "12 s worst case" counts headers only. Reading the body has no time limit, as today.

**4. MAJOR: the function format is the old Lambda-style one, and Netlify is retiring it.**
- Netlify's Lambda compatibility page: "As of July 1, 2027, deploys containing functions in this mode will no longer be accepted."
- `multiValueQueryStringParameters` is not documented there, and every `durable` example is in the modern format. Whether `durable` works for Lambda-style functions is unverified.
- Recommendation: write `usgs-proxy` in the modern format (`export default (req)`) with `config.path: '/api/usgs'` and `method: 'GET'`.
  - This removes the redirect.
  - It closes the `/.netlify/functions/` bypass ("When you set a custom path, the function is only available at that path").
  - `new URL(req.url).search` gives the raw query needed for finding 1.
  - The rollback section then changes accordingly.

**5. MAJOR: the main set is at 72% of a hard 50,000-row limit.**
- I checked this with a keyless request: `limit=100000` returns 400 with "Limit of 50000 exceeded".
- The main set is 36,126 rows. If a few gauges move from 15-minute to 5-minute readings, the answer becomes paged.
- The adapter rejects paged answers, so both stages fail together and every user falls to the saved copy with no warning.
- Recommendation: log the row count. Either split the main set upstream (flow and stage as separate calls), or add a TODO with a threshold of about 42,000.

**6. MINOR: the list of tests to change is incomplete and understates the work.**
- The Edwards Ferry stubs at `clean-screen-behaviour:93`, `forecast-accuracy-row:94` and `startup-refresh-behaviour:88` match `url.includes('01644148')`. `/api/usgs?set=ef` does not contain that number.
- `data-freshness` tests 26–32 and 48–51 assert `proxyCalls === 2` and the relay chain. They need rewriting, not just new stubs.
- Stage 2 stubs must return the new-service shape (`features`, `timeStamp`), because that answer goes through the browser adapter.
- The "unchanged" claim for `usgs-adapter.test.js` holds only if adding markers does not touch its asserts.

**7. MINOR: the parity test plan has three small errors.**
- Test 8 lists "unknown qualifier" as an error case, but the adapter passes unknown codes through (`usgs-adapter.js:100`).
- Adding the shared-text markers edits `netlify/functions/shared/usgs-adapter.js`, which section 1 does not list.
- Pairing the CommonJS server file with the ES-module browser copy is workable: load the server copy with `createRequire` and keep `module.exports` / `export` outside the markers.

**8. MINOR: the direct-call cache `pp-data-direct` is not worth having.**
- Its only use is handing back an old copy of about 11.8 MB, which the phone then has to parse and convert. The localStorage copy does the same job.
- Recommendation: no service worker route for the direct main call.
- Memory and time on a phone look fine. Synthetic 36,126 rows on a Mac: parse 22 ms, conversion 26 ms, output 2.82 MB (107 kB gzipped). Phone speed is unverified.

**9. MINOR: the 10-minute rule (question 2).**
- A healthy answer (body at most 150 s old) can only be classified "saved copy" if the device clock is more than about 7.5 min fast. The tolerance was 10 min before.
- It also assumes the durable cache does not restart the 120 s clock when an edge copies from it (unverified).
- Recommendation: state the new 7.5 min tolerance in the plan and in the comments in `data-freshness.js`.
- Line 117, "plus real publish lag", is wrong: the body time is the response time, not the publish time.

**10. MINOR: two Netlify facts in the plan are off.**
- The synchronous time limit is documented as 60 s, not the 10 s the plan assumed (the assumption errs on the safe side).
- The 6 MB buffered limit is confirmed.
- Netlify's docs do not say whether error responses are cached, or how compression is handled.

**11. MINOR: the rollback claims are partly wrong.**
- There is no catch-all SPA rewrite in Netlify, so removing the redirect gives a 404, not the SPA page. The effect is the same: the app falls to stage 2.
- "The `old_nokey` path covers it" overstates things: that is the degraded old service that caused the alerts.

**12. MINOR: verification gaps (section 9).**
- Unverified until a forced test:
  - stage 2 has never run live;
  - error caching and `durable` behaviour need a branch deploy with no key;
  - one `cache-status` check can land on a different cache instance;
  - whether a client sending `Cache-Control: no-cache` bypasses the edge cache.
- These need a real screen:
  - the content-security-policy line being enforced by the browser;
  - the service worker behaviour, including clients that already have the old version installed;
  - Safari reading the 6-digit fraction in `timeStamp`;
  - load time.
- Recommendation: a desktop browser check that blocks `/api/usgs` in developer tools, then confirm the app falls to the direct call.

**13. These claims hold.**
- Address inventory:
  - every old-host, relay and `requestDT` location is listed;
  - no test pins `connect-src` (`map-removed:52` pins only `img-src`);
  - a non-200 answer from the function passes through Workbox 7.4.1 to the page (`NetworkFirst._getNetworkPromise` returns the response and only skips caching it);
  - the claims about already-installed clients and keeping the old cache names are right.
- Visible wording:
  - no visible text changes;
  - only the hover title's "Server response" time shifts, by up to 150 s.
- Versions:
  - versions v39.12 and v39.13 fit the project's version rules;
  - the browser adapter and parity test must go in push B.
- USGS service:
  - it sends `cache-control: no-store` and `access-control-allow-origin: *`;
  - `timeStamp` is live, not a cached value.

### Not checked
- The Netlify edge behaviour itself: `durable` and stale-while-revalidate on function responses, compression, `Netlify-Vary` with encoded values, HEAD caching.
- Keyless rate limits.
- Real speed on a phone.
- Safari date parsing.
- The double-run check from Step 0.
- `test/howitworks-text.test.mjs` internals.

Scratch files are in `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/audit2/`. I made 3 keyless requests to USGS.

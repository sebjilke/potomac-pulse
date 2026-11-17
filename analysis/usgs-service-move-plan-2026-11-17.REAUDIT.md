# Independent re-audit of the Step 1 build

Auditor: a fresh subagent (Opus) that did not write the code, read-only, 2026-11-17. Text extracted by script from the auditor's final report, not retyped.

## Re-audit: USGS Step 1 (v39.11). Verdict: SHIP AFTER FIXES

### Findings

**1. BLOCKER: the duplicate-series guard can never fire in production, so two series would silently become one wrong number.**
- Evidence: `usgs-adapter.js:12` sets `PROPERTIES` without `time_series_id`. `:80` then reads `p.time_series_id`, which is always undefined, so every row gets `''` and the "two different series" check at `:83` never throws.
- I sent one keyless request with that exact `properties=` list (`/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/reaudit/r1.json`). The returned properties had no `time_series_id`.
- I fed `toLegacyIv` two interleaved series without ids (sensor A ≈5000, sensor B ≈9100). It returned one merged block `["5000","9000","9100","5010"]`. The parser would take 5010 as the latest Little Falls reading, with no error.
- The tests miss this because both stubs (`usgs-adapter.test.js:38`, `usgs-step1-handler.test.js:46`) and both fixtures were built without `properties=`, so they always carry `time_series_id`.
- The docs (CHANGELOG, CLAUDE.md, appendix) say two series "fails the request". That is not true in production.
- Fix:
  - Add `time_series_id` to `PROPERTIES`.
  - Also throw on duplicate timestamps within a group, as a second guard.
  - Add a test that runs a fixture shaped like the real `properties=` answer.

**2. MINOR: a malformed key value is written into the logs.**
- In Node, `fetch` with a header value containing a newline or control character throws `Headers.append: "SECRET\nabc" is an invalid header value.`, with the value inside the message (tested on Node 24).
- `fetchNewIvJson` (`scheduled-update.js` ~249) logs `e.message`, so the main and temperature requests would print the key to the Netlify logs. Difficult Run does not log the message.
- `noKeyAnywhere` cannot catch this because its test key is valid.
- Fix: in `usgsRequest`, reject a key that fails `/^[\x21-\x7e]+$/` (treat it as `old_nokey` and log "key malformed"), or remove the key from logged messages.

**3. MAJOR (docs honesty): TODO leaves out the biggest open items.**
- There is no open line for:
  - Step 2: the app still reads the old service and breaks on 2027-02-22.
  - The live check of Step 1 (three runs).
  - The ice path and the 429 path, which are not verified live.
  - Whether a changed Netlify variable needs "Trigger deploy". Step 0 said this would be confirmed in Step 1; it was not.
  - The adapter parity test due in Step 2.
- Fix: add those as D5 to D8.

**4. MINOR: an empty answer, or a renamed `statistic_id`, quietly means "no data".**
- `{features:[]}`, or rows whose `statistic_id` is missing or renamed, give `timeSeries: []` and a valid result. The run ends as `null_lf_or_por`, not as a failure.
- The old service behaves the same on an empty answer, but a new-service schema change would hide this way.
- Fix: throw in `toLegacyIv` when there are features but zero `00011` rows.

**5. MINOR: some odd input shapes are dropped without a trace.**
- A `qualifier` given as a string (`'ICE'`) is ignored.
- `approval_status` values other than Provisional/Approved (e.g. "Revised") add no flag.
- A lowercase `usgs-` prefix keeps the prefix, so that gauge is treated as missing (safe).
- None of these gives a wrong number: ice is still caught by `null` → `-999999`, and the Difficult Run fields are log-only. Fix: accept a string qualifier as a one-item list and report unmapped approval statuses in `unkQ`.

**6. MINOR: spec deviation on unknown codes.** Ruling 1 says an unknown code "fails the test, it is not passed through silently". The code passes it through and logs it to `aux.unkQ` plus a console warning. That is defensible, but the plan should record it as an amendment.

**7. MINOR: `validation_log` and `bin_snapshot` also move to `v:3`, since they share `LOG_SCHEMA`, with no field change.** The appendix describes schema 3 only for `tick_log`. Add one sentence.

### Checks that passed
- **Parsers untouched.** Only the lines that get the JSON changed. With no `headers`, `fetchWithTimeout` makes the same call as before. The old path keeps the same address, the 10 s timeout, the same logs and returns (the no-key test compares the addresses byte for byte).
- **Timeouts.** One timer covers both the request and the body read, so a body that stalls after the headers is cut off. Late rejections are swallowed and the timer is cleared in `finally`. Worst case for the main request is 5 + 4 = 9 s, with temperature running alongside; the old path allowed 10 s. Difficult Run keeps its 2 s cap and the 20 s skip. No retry on 429, other 4xx, or a parse or paging error. Failures go through the existing "Failed to fetch USGS data" path and failure signal.
- **Key handling.** The key travels only in the header. It is never in an address, a `tick_log` row or a thrown error, apart from finding 2. There is no Sentry in the code.
- **`tick_log` fields.** `src`, `att`, `pub` and `aux.unkQ` are read only by `buildTickRecord`; grep confirms no other reader. Size is bounded (12 sites, 10 codes). Each field is wrapped in `logTry`.
- **Bundling.** The require of `./shared/usgs-adapter` is static, so esbuild bundles it.
- **Versions.** Every version place reads v39.11, and the version test passes.
- **Edge cases that fail loudly:** a missing `features` array, an error object returned with HTTP 200, a missing or unreadable `time`, a null feature, and a paged answer all throw, so the request fails. A numeric `value` becomes a correct string.
- **Real answer.** A keyless main request (7 gauges, P2D) returned HTTP 200 in 1.9 s: 2.56 MB, 5,535 rows, 13 series, no next link, no duplicate timestamps. The adapter output is well-formed.

### Tests
- `npm test`: 1465 tests, 1463 pass, 0 fail, 2 skipped.
- The new tests use mocked timers and stubbed `fetch`: no network, no wall clock.
- The three edited existing tests changed only the version and schema numbers.
- Mutations, each run on copies in `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/reaudit/m/`:

| Mutation | Caught? |
|---|---|
| Sort removed | Yes, 1 test failed |
| `P`/`A` moved after the other codes | Yes, 4 failed |
| Retry on 429 and other 4xx | Yes, 2 failed |
| `statistic_id` filter removed | Yes, 1 failed |

- The gap is the property list, not the logic (finding 1).

### Deploy safety
- With no key, behaviour is identical to before; the only addition is `src: 'old_nokey'` in the log.
- With the key set, the first-run risks are:
  - Finding 1 (dormant until USGS serves a second series).
  - A 2.5 MB answer under a 5 s cap from Netlify's region. The parse itself works; I did not measure timing from Netlify's region.
  - Whether the variable takes effect without a redeploy.

### Verdict: SHIP AFTER FIXES
1. Finding 1: add `time_series_id` to the property list, add the duplicate-timestamp guard, and add a test on a real-shaped answer.
2. Finding 2: validate or redact the key.
3. Finding 3: add the missing TODO lines.

Findings 4 to 7 are optional.

### Not checked
- `npm run build` and real Netlify bundling or loading of the function.
- Behaviour with a real key: rate-limit headers, timing from Netlify's region.
- Double-run harm.
- How the old service would label a second series.
- Whether the new service ever leaves out ice rows instead of sending them with a null value.

Two keyless GETs were used out of the 6 allowed.

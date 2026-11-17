# Independent re-audit of push B (the app reads /api/usgs)

Auditor: a fresh subagent (Opus) that did not write the code, read-only, 2026-11-17. Text extracted by script from the auditor's final report, not retyped.

**Re-audit of push B (v39.13). Verdict: SHIP AFTER FIXES. No blockers, no majors, five minors.**

**What holds**
- **Parsers and model are untouched.** In `fetch.js` and `edwards-ferry.js` only these changed: how the JSON is obtained, the stage order, the removed relay loop, comments and log text. `processData`, the creek, Edwards Ferry and temperature parsers, and the `bodyTimeMs`/classification code are unchanged. Nothing changed under `src/model/`, `src/learning/` or the other `src/estimation/` files. In `netlify/functions/` the only change is the two marker lines.
- **Live bodies agree exactly.** 4 GETs to `/api/usgs` and 6 keyless GETs to the new service.
  - The `value.timeSeries` arrays from stage 1 and from stage 2 (browser adapter over the real responses) are deep-equal, order included, for all four sets: main 38/38 series, creeks 4/4, ef 1/1, temp 1/1. So every parser output is identical.
  - Little Falls 1640 cfs / 2.74 ft and Point of Rocks 1820 cfs / 1.12 ft (16:50–16:55Z) on both paths.
  - Body age: 4 s (function), 1 s (direct). The 6-digit `timeStamp` parses in Node/V8.
  - Direct calls send only `signal` (no preflight). USGS answers with `access-control-allow-origin: *`.
  - Function `main` time to first byte was 3.4 s, inside the 7 s / 8 s timers.
- **localStorage size went down.** The saved main body is 2,711,392 characters, against about 2.9 MB before, so QuotaExceeded is no more likely than before. If it does happen, `saveToCache` catches it and only logs.
- **Chain walk matches HEAD** for every path you listed. Specifically:
  - Stage 2 goes through `validateUSGSResponse`.
  - `fetchOldShape` never throws.
  - Page timers are cleared in `finally`. A failing `main` call aborts its sibling, and `Promise.all` handles the sibling's rejection.
  - No new loop or double fetch: the `isFetching` guard, the 60 min memo and the early refetch are unchanged.
- **Service worker rules (from the built `dist/sw.js`):**
  - Only `/api/usgs?set=main` hits the 7 s rule. The other sets and NWS hit the 5 s rule. `/api/sync` and the direct new-service addresses match no rule.
  - A 503 from the function passes through to the page (Workbox NetworkFirst falls back to its cache only on a network error or timeout), so it is never stored and served as data. Status `0` cannot occur for a same-origin call.
- **Security policy:** the bundle never mentions the old host or either relay, and every host the bundle calls is in the new `connect-src`.
- **Adapter parity:** the shared text is byte-identical (`diff` on the exact marker lines). The parity test executes both copies. No Node-only constructs in the browser copy.
- **Tests:**
  - `npm test`: 1603 tests, 1601 pass, 2 skipped (HEAD: 1561 / 1559).
  - The five edited test files have the same or more tests and `assert` calls as at HEAD (sw-runtime-caching 11→13 tests, 43→53 asserts; the others unchanged).
  - The data-freshness count change 2→4 is honest: one walk to stage 2 is two requests.
  - No network or wall-clock dependence; all fetches are stubbed.
- **Wording:** `index.html` changes only the two version strings. The new strings in `src/` are console logs only. The version-agreement test passes. The TODO D13 gaps are stated honestly.

**Findings**

1. **MINOR — the small-set timer breaks ruling 3.** Ruling 3 says cap + 1.5 s **<** service worker timeout. Creeks/ef/temp are 3500 + 1500 = 5000 ms against a 5 s timeout, so the test was relaxed to `<=` (`test/sw-runtime-caching.test.mjs` test 4, which carries a NOTE about this). The ruling's own numbers cannot satisfy it.
   - Effect: when the function runs near its cap, the service worker can hand back its saved copy (up to 6 h old). `fetchOldShape` takes that copy without trying stage 2. Not unsafe: the creek cards grey out readings older than 2 h.
   - Fix: the orchestrator rules on it. Either `networkTimeoutSeconds: 5.5` for the general rule (still under the 6 s page timer), or a 3.0 s cap in the next server push. Then restore the strict `<`.

2. **MINOR — an older saved copy can overwrite a newer localStorage copy.** Direct answers are not saved by the service worker (ruling 8).
   - Sequence: cycle N, stage 1 fails, stage 2 is fresh, localStorage holds reading T2. Cycle N+1, stage 1 is slow, the service worker serves its older function copy T1, stage 2 gets a 429. Then `accept()` saves T1 over T2 and shows the older reading as "live".
   - The same class existed at HEAD, but the window is wider now.
   - Fix: in `fetchUSGS`, before accepting a `best` that is not fresh, compare `payloadReadingMs(loadFromCache()?.data)` and keep the newer copy.

3. **MINOR (existed before, now reachable a new way) — an empty answer counts as a live success.**
   - Mechanism: if the new service returns `features: []`, the adapter gives `timeSeries: []`, which passes `validateUSGSResponse`. `payloadReadingMs` is null, so the answer counts as 'readings-fresh' and is accepted at once: no stage 2, the good localStorage copy is overwritten and the estimate area turns UNAVAILABLE.
   - `usgs-proxy.mjs` has no empty-answer guard either, so one empty answer could also be shared at the edge for about 120 s.
   - Fix: reject a `main` answer that has no Little Falls/Point of Rocks 00060 series in `fetchFromFunction`/`fetchFromDirect` (or in `validateUSGSResponse`), and add the same guard on the server.

4. **MINOR — a test gap.** My mutation M2 removed `validateUSGSResponse` from the stage-2 branch and every test still passed. In practice the adapter always produces valid structure, but nothing pins the check. Fix: a test where stage 2 returns a body with a series missing `siteCode` (bypassing the adapter via stub).

5. **MINOR — clean-up and leftovers.**
   - The old 2.9 MB `waterservices` entry in `pp-data-main`, and old relay entries in `pp-data`, stay in installed clients until expiry trims them (at most 6 h, or when the next write triggers trimming).
   - The answer body is read with no timer (as before), so a stalled body leaves `isFetching` set. That is not new, but the direct main body is about 1.1 MB on the wire.
   - `fetch.js:40` JSDoc still says "waterservices API".

**Mutations** (on copies, full suite each)

| Mutation | Caught? |
|---|---|
| M1: `main` merge keeps the newer `timeStamp` | Caught (2 failures) |
| M2: stage 2 skips `validateUSGSResponse` | **Not caught** (finding 4) |
| M3: general service-worker rule widened to `/api/*` | Caught (2) |
| M4: custom header added on fetch (would force a preflight) | Caught (2) |
| M5 (extra): stage-1 saved copy accepted without walking to stage 2 | Caught (13) |

**Freshness with the shared copy:** a healthy stage-1 answer cannot be classified as a saved copy unless the readings are already at least 120 min old **and** the device clock runs more than about 7.5 min fast. Even then, the 60 min memo limits it to one direct walk per reading time. The label is based on reading times, so its wording is unchanged.

**Fixes before ship**
1. Rule on finding 1: either `networkTimeoutSeconds: 5.5` in the general service-worker rule plus the strict `<` in test 4, or write down the deviation from ruling 3.
2. Add the empty or missing-headline-gauge guard (finding 3), on the client and in the function.
3. Add the stage-2 validation test (finding 4).

The localStorage newer-copy check (finding 2) can be a TODO row.

**Not checked**
- Safari/JavaScriptCore parsing the 6-digit `timeStamp`. I could not run it; I believe it parses, but that is unverified. If it fails, the effect is limited: only the early-refetch decision after a stage-2 answer is affected, never the label or the estimate.
- A real browser run under the new security policy, and installed v39.12 clients switching over.
- The keyless rate limit; one direct GET with an `Origin` header showed no rate-limit headers.
- `processData` end to end on the live body. I skipped it because the inputs are deep-equal across the two stages.

Scratch files are in `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/reaudit3/` (`live.mjs`, `cmp.mjs`, `mut.py`, the `*_f.json` and `*_d.json` bodies). `npm run build` rewrote `dist/`, which git does not track. The repository is otherwise unchanged.

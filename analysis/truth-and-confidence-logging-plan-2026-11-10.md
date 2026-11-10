# Plan v39.6: log Difficult Run beside the truth, and log the fresh-load confidence label and band

Status: FINAL SPECIFICATION after the independent plan audit (15 findings, all accepted; see "Audit response" at the end). Supersedes the v39.5 draft. Implemented as v39.6. Line numbers refer to `netlify/functions/scheduled-update.js` ("S") at HEAD of v39.5.
Decisions: A5 option C and A8 "keep label, log it" (`analysis/decision-brief-A5-A8-2026-11-10.md`). Background and invariants: `analysis/prediction-logging-plan-2026-11-10.md` (v39.2).
Version: v39.6, MINOR. The estimate, learning and truth do not change. `SERVER_VERSION = 'v39.6'`, `LOG_SCHEMA = 2`.

## 0. Invariants (all outrank everything else)

- I1. `makeGFPrediction`'s return value and every value stored in a pre-existing record type are identical with and without the new logging. `netlify/functions/shared/model.js` and `src/model/` are byte-identical to HEAD. The truth used for learning stays Little Falls alone (`actualCFS = lf.q`).
- I2. No new I/O before the success ping. Every new operation is wrapped, time-bounded and non-fatal. A good tick can never be reported failed because of this feature.
- I3. Pruning is untouched.
- I4. Existing characterization, golden and parity tests stay green and unmodified. The only pre-existing test line changed is `prediction-logging-writer.test.js:77` (`rec.v === 1` becomes `2`, for LOG_SCHEMA, PA-12).
- If a requirement cannot be met without touching the estimate path, that logging feature is dropped.

## 1. What the code does today (verified)

- Truth: `actualCFS = lf.q` (S:1088); reading time `lf.qTime` is already logged as `actualT`.
- Validation rows are built at S:1823 and QUEUED, then written after the ping (`flushDeferredLogs`, S:2944). Everything from the ping to `return` is inside the handler `try`; a throw there goes to the catch (second /fail ping, 500, `out:'error'` row).
- The server never fetches Difficult Run. One read-only GET on 2026-11-10: 15-minute steps, provisional `P`, newest reading 73 minutes old, 0.09 s. USGS delivers in hourly batches (four readings can arrive at once).
- The label is computed only in the browser (G:537-558, `src/estimation/great-falls.js`) and lowered per active advisory in `src/ui/great-falls-ui.js:205-217` (`downgradeConfidence`). The band table exists only in `src/model/constants.js` (`EMPIRICAL_CI_90`). The client band is `[est - q95, est - q05]` around `Math.round(correctedFinal)` (the capped value) looked up in the bin of the RAW UNCLIPPED final (`pred.flowBin`).
- Most label ingredients are already in `tick_log` (`in.mono.q`, `in.goose.q`, `trv.nohist`, `ef.used`, `corr.st`, `adv.ef`, `adv.lfr`). The band is derivable from `final.cfs`, `corr.bin`, `corr.st`. New information is the Edwards Ferry stage tail and the Difficult Run readings; `conf` and `ci` are convenience columns.
- `fetchWithTimeout` (S:159) clears its timer when headers arrive; `response.json()` is unbounded. The new fetch bounds fetch and body with one real timer.
- No Difficult Run to Little Falls lag exists in the repo. We log raw readings and never a subtraction.

## 2. Design

### 2.1 Difficult Run fetch (A5)

`fetchDifficultRun(opts)` in S. One GET, a SEPARATE request (never a site added to the main request, whose failure would fail the tick): `https://waterservices.usgs.gov/nwis/iv/?sites=01646000&parameterCd=00060&period=PT6H&format=json`. The URL has no `parameterCd=00060,00065`, so the existing mocks do not route it.

Placement (PA-1, PA-3): after the success ping, before `flushDeferredLogs`, in its OWN `try { ... } catch (_) {}` that contains BOTH the fetch and the attach code. Nothing in it can reach the handler's catch, send a /fail ping or return 500. The fetch is skipped when `Date.now() - tickStartMs > 20000` (`why: 'late_skip'`): the tick row is worth more than one reading. It never runs on the catch path.

Time bound (PA-3): one `setTimeout` (not `AbortSignal.timeout`) of 2000 ms races the whole `fetch` plus `response.json()` body read. When the timer wins, the `AbortController` is aborted (which also stops a body read) and the work promise is detached with its rejection handled. The timer is cleared in `finally`. Worst case added after the ping: 2.0 s (DR) + 3 s (general log pool) + 3 s (tick pool) = 8 s, asserted by a test at or under 8.5 s virtual with the fetch and every log write hanging.

Parse (PA-4, PA-13): inside the guarded block read `response.ok` and `status`. Select the series by `siteCode == 01646000` and `variableCode == 00060`, not by position. If there are several `values` blocks (method ids) take the block whose newest reading is latest. Take the LAST reading of that block by time. Result:

`{ q, t, at, ms, qual, why, ageMin, tail }`
- `q`: discharge cfs of the last reading, or null.
- `t`: reading time, epoch ms (the `-05:00` offset is parsed by `Date.parse`).
- `at`: fetch start, epoch ms. `ms`: duration of fetch plus parse in ms.
- `qual`: qualifier codes of the last reading, stored as read (`['P']`, `['P','e']`, `['Ice']`, `Eqp`, `Bkw` are stored, never interpreted).
- `ageMin`: `(at - t) / 60000`, one decimal.
- `why`: null on success, else `http_error | parse_error | no_series | sentinel | ice | invalid | future | old | timeout | fetch_error | late_skip | internal_error`. `old` means ageMin over 180 and `future` means ageMin below 0; BOTH keep `q` and `t` (analysis decides). Zero is valid (low flow). A last value that is the sentinel (-999999 or lower) gives `q` null with `why: 'sentinel'` even when earlier values are valid (documents "last value only").
- `tail` (PA-5): all valid readings of the PT6H window (capped at the last 32), compact: `{t0, step: 15, v: [...]}` when the times are exactly 15 minutes apart from `t0` (an invalid value is `null` in `v`), else `{ts: [epoch ms...], v: [...]}`. Raw values only; no pre-subtracted number.

Where it is stored:
- `tick_log`: `in.dr` = the full object above. `in.dr` is null when no fetch was attempted (error path, no USGS data), and `{why:'late_skip', ...}` when skipped on time.
- `validation_log`: claimed rows that carry `actualCFS` (validated, hard_flagged, bin_read_failed; not claimed_then_threw, not the non-claimed fates) get `dr` = the same object WITHOUT `tail`, plus `tickAt` (the tick row's `at`, the join key to the tail). Attached by a pure `attachDr(queue, dr, tickStartMs)` before the existing flush; row ids, other fields and write order are unchanged.
- Nothing reads `dr` except the record builders. Learning truth stays `lf.q`.

### 2.2 Edwards Ferry stage tail (PA-2, PA-6)

Nothing is computed on the estimate's input path. Inside `fetchUSGSData`, for the EF gauge and parameter `00065` only, a copy of the last 16 readings `[{t, v}]` as plain numbers is assigned to `data[ef].hTail` inside its OWN inner `try/catch` (assignment last, so a failure leaves the field absent). Any derived value (the 1 h trend) is computed in `buildTickRecord`, which runs inside `finalizeTick`'s try. `makeGFPrediction` never reads `hTail`; a test proves its result is identical with the field present and stripped (rising, falling, steady and short EF series).

`tick_log.in.efx.tail` = the raw stage tail (kept in `in.efx`, beside `in.ef`, because a pre-existing test pins the exact shape of `in.ef`), compact as above (stage ft, 2 decimals). Readings outside `0 < stage < 100` or non-finite are dropped (same filter as the client). `in.efx.tr1h` = trend of that series under the client rule: needs at least 4 entries, compares the last with `history[max(0, len - 5)]`, plus or minus 2 percent. It is a convenience only (a server variant that no visitor sees).

### 2.3 Confidence label (A8), what is and is not claimed (PA-6)

The server label is NOT canonical and is NOT what visitors saw. The primary measure is named `freshLoad`: **the label a FRESH page load would show for the cron's readings**, i.e. the browser rule applied with the Edwards Ferry trend = null. A fresh visitor (the modal visitor) has no EF trend because the browser trend needs about four distinct hourly arrivals in an open tab. A visitor with a long-open tab (about three hours or more) can see a label one notch different, because the EF trend cross-check can then lower high to medium or raise medium to high. Other remaining gaps: the visitor's fetch moment (up to 59 minutes after the cron's), the client flowState method (robust rise rate versus raw), the visitor's porHistory, and the client EF hysteresis multiplier. The raw EF stage tail is logged so the long-open-tab variant can be rebuilt offline.

`tick_log.conf` (null when no prediction):
- `freshLoad`: `confidenceLabel({hasTribs, shifted, efUsed, efTrend: null, flowState})`: 'high' | 'medium' | 'low'.
- `freshLoadShown`: `freshLoad` lowered one notch per active advisory (`adv.ef`, `adv.lfr`), exactly as `great-falls-ui.js`. Null when either advisory state is unknown (null), never treated as inactive.
- `tribs`, `shift`, `ef`, `st`: the ingredients used (`hasTribs`, `shifted`, `efUsed`, `flowState`).
- `advEf`, `advLfr`: advisory flags as used (true, false or null).

`confidenceLabel` and the downgrade are pure functions in S, called ONLY from `buildTickRecord`. They are copies of browser code, bound by the tests of section 5 (PA-7).

### 2.4 Band (A8, PA-8)

`netlify/functions/shared/ci-table.js` (CommonJS, deep-frozen copy of `EMPIRICAL_CI_90` and pure `bandFor(estimateCFS, bin, state)`). `bandFor` is called as `bandFor(pred.predictedCFS, pred.flowBin, pred.flowState)`: centre = the capped, rounded displayed value; table row = the bin of the RAW UNCLIPPED final (`pred.flowBin`), not the bin of the capped value. Returns `null` where the client `getGFUncertainty` returns null (unknown bin). Keeps `ciData[state] || ciData.all`. Formula as the client: `lo = max(0, round(est - q95))`, `hi = round(est - q05)`.

`tick_log.ci` = `{lo, hi, q05, q95, bin, st}` or null. Derivable from `final.cfs`, `corr.bin`, `corr.st` and the table at `commit`, so it is a convenience column. The file name avoids `index.js` and `shared.js`; it is bundled by esbuild into scheduled-update only. A load-time error would crash every tick before any ping, so the parity test `require`s it.

### 2.5 Schema and versions (PA-11, PA-12)

`LOG_SCHEMA = 2`: with presence-only decoding an error-path row cannot be told from a pre-v39.6 row. `ver` is `v39.6`. Pre-v39.6 rows stay schema 1 and have none of the new fields.

### 2.6 Rejected alternatives

DR as a site in the main request (can fail the estimate); DR before the ping (can delay it); DR inside the validation loop (a new hang point before learning writes); client-side logging of what visitors saw (new public write path); a deterministic browser trend (changes the displayed estimate, needs its own plan and owner decision); `hTrend` computed in `fetchUSGSData` (estimate input path, PA-2).

## 3. Files

| File | Change |
|---|---|
| `netlify/functions/scheduled-update.js` | `SERVER_VERSION='v39.6'`, `LOG_SCHEMA=2`; EF tail copy in `fetchUSGSData`; `fetchDifficultRun`, `attachDr`, `confidenceLabel`, `downgradeLabel`, `efTrendOfTail`, `compactSeries`; `buildTickRecord` adds `in.dr`, `in.ef.tail`, `in.efx.tr1h`, `conf`, `ci`; handler: guarded DR block after the ping; `_test` exports. |
| `netlify/functions/shared/ci-table.js` | NEW. Frozen table copy and `bandFor`. |
| `netlify/functions/shared/model.js`, `src/**` | NONE (byte-identical). |
| `test/prediction-logging-writer.test.js` | line 77 only (`rec.v` 1 to 2). |
| New tests | `test/truth-dr-fetch.test.js`, `test/truth-dr-handler.test.js`, `test/confidence-parity.test.mjs`, `test/helpers/usgs-mock.js`. |
| Docs, version | `index.html` (app-version meta, footer text), `CLAUDE.md` (version header, "Current Model Parameters (v39.6)" bullet, "Audit logging" bullet, Versioning Rules parity pairs), `README.md`, `src/assets/CHANGELOG.md`, Tech Appendix (current-version line, footer, section 6.10 fields and wording), `TODO.md` (header, test count, Recently completed, A5 and A8 rows: logging live, backtests pending). |

Browser parity binding (PA-7): the browser label lines are NOT extracted into a function (that would touch `src/estimation/great-falls.js`, the estimate module). Instead the parity test extracts the exact source text between the `// Confidence` marker and the `// Forecast` marker in `great-falls.js` and the `shownConfidence` lines in `great-falls-ui.js`, and EXECUTES that text over all inputs. A change to those lines changes the table or breaks the extraction markers, and the test fails until the server copy is updated. This binds behaviour, not a hash.

## 4. Invariant arguments

1. Estimate and learning: the DR block is after the ping and inside its own try; `hTail` is a write-only copy; builders only read. `shared/model.js` and `src/model/` are untouched. Proven by tests (section 5) and `git diff --stat`.
2. No pre-ping I/O: the only pre-ping addition is the `hTail` array copy (no I/O).
3. Non-fatal and bounded: section 2.1.
4. Pools: the DR time is outside the `general` and `tick` pools; worst case 8 s.
5. Row size: tick row about +0.6 KB (DR tail about 0.2 KB, EF tail about 0.2 KB, conf and ci about 0.15 KB), validation row about +0.1 KB.

## 5. Tests (new files only; the one edited line is named in I4)

- Fetch unit: http_error, parse_error, HTML body with 200, no_series, series selected by site and parameter (decoy first), sentinel as last value with valid earlier values, `value: []`, ice, invalid (-5), zero kept, old kept with q and t, future, two `values` blocks, qualifiers `P`, `P,e`, `Eqp`, `Bkw` stored, `-05:00` parse, tail regular and irregular, tail null for invalid values.
- Timer: hang before headers and body never resolving after headers both give `timeout` within 2.0 s with mock timers; the abort signal is fired; removing the cap fails.
- Handler A/B with the seven arms (ok; error status; network error; hang before headers; hang after headers; sentinel value; empty series), plus throwing getters (PA-1), late_skip, and DR hang with every log write hanging. In every arm: the non-log write sequence and payloads, final non-log rows, the 200 body and the pings are identical; exactly one `ok` ping and no `fail` ping; ping index below DR GET index below first log write; the DR URL has `sites=01646000` and is fetched at most once, never on the catch path; the main USGS URL equals the pre-change string byte for byte; every pre-existing stored log field is equal to the baseline arm (new fields stripped). The fetch mock records every URL, routes DR by `sites=01646000` first and throws on anything else.
- Truth: DR at 5,000 cfs leaves `actualCFS`, `errRawCFS` and bins equal to the baseline arm.
- `makeGFPrediction` equal with `hTail` present and stripped; `fetchUSGSData` EF tail failure (a throwing element) leaves the result otherwise identical.
- Label: 96-row truth table (tribs x shifted x ensemble x trend[4] x flowState[3]) of the server `confidenceLabel` against the EXECUTED browser source text; downgrade against the browser's `downgradeConfidence` and the executed `shownConfidence` lines; `freshLoadShown` null on unknown advisory.
- Band: `ci-table.js` deep-equals `EMPIRICAL_CI_90` (via the harness); `bandFor` equals the client formula on a grid including low floored at 0, unknown bin gives null, unknown state falls back to `all`; capped fixture where the capped value's bin differs from `pred.flowBin`.
- EF trend: +3, -3, +1 percent, fewer than 4 entries, exactly 4 entries (looks 3 back), stage filter drops -999999 and 100+.
- Record shape: `conf` and `ci` null on ice and error ticks; `in.dr` null on the error path; schema 2.
- Pruning: `pruneLogType` still refuses any new type.
- Existing suites unchanged and green.

## 6. What can only be confirmed in production (gaps, not passes)

1. The first real DR reading and its parse; the real fetch time; the DR outage rate (counts of `why` over weeks).
2. How often `freshLoad` differs from a long-open-tab label (needs the EF tail and offline rebuild).
3. Row sizes (`pg_column_size`) after 24 ticks.
4. The 30 s scheduled-function limit and any lost tick rows (known gap 10 of the v39.2 plan).
5. That nothing changes in the estimate over the next days (the A/B tests prove the code path, not the production run).

## Audit response (plan audit of 2026-11-10, verdict approve_with_changes)

- PA-1 ACCEPTED: the DR fetch and the attach code sit after the ping in their own try/catch; `response.ok` and `status` are read inside the guarded block; tests with throwing getters assert 200, one ok ping, no fail ping.
- PA-2 ACCEPTED: no trend code in `fetchUSGSData`'s main flow; the raw EF stage tail is copied in its own inner try/catch; the trend is computed in `buildTickRecord`; a test proves `makeGFPrediction` is identical with the field present and stripped.
- PA-3 ACCEPTED: skip the DR fetch after about 20 s (`late_skip`); a real `setTimeout` 2 s cap aborts the request and bounds the body; combined hang test at or under 8.5 s.
- PA-4 ACCEPTED: each DR reading carries value, reading time, fetch time, duration and qualifier codes; the series is chosen by site and parameter code.
- PA-5 ACCEPTED: the tick row carries the 6 hour DR tail compactly; old readings are kept with their time.
- PA-6 ACCEPTED: the server label is not called canonical; `conf.freshLoad` (fresh page load, EF trend null) is the primary measure, with the raw EF stage tail logged; docs state the long-open-tab one-notch gap; unknown advisory gives null.
- PA-7 ACCEPTED: a 96-row truth table against the executed browser source text plus the browser's `downgradeConfidence`; no browser edit, no hash pin needed because the source text is executed.
- PA-8 ACCEPTED: `bandFor(pred.predictedCFS, pred.flowBin, pred.flowState)`, null where the page shows no band, capped-case test.
- PA-9 ACCEPTED: handler A/B test with the seven arms and the extra arms, comparing every pre-existing stored row, the return value and the pings; main URL asserted byte for byte.
- PA-10 ACCEPTED: new tests use a recording mock that routes the DR URL by `sites=01646000` and still throws on anything else; the existing throw is untouched.
- PA-11 ACCEPTED: v39.6 in every place the Versioning Rules require, including the meta and footer in `index.html`, Tech Appendix line and footer, README, CHANGELOG, TODO.md.
- PA-12 ACCEPTED: `LOG_SCHEMA = 2`; only `prediction-logging-writer.test.js:77` is updated, for that reason, and reported.
- PA-13 ACCEPTED: sentinel last value, empty `value: []`, HTML 200 body, future time, two values blocks, Eqp and Bkw qualifiers are all tested; old readings are kept.
- PA-14 ACCEPTED: the trend mirrors the client rule (at least 4 entries, `history[max(0, len - 5)]`, stage filter `0 < stage < 100`).
- PA-15 ACCEPTED: `ci-table.js` is a safe new shared file (no `index.js` or `shared.js` name), the parity test requires it, and `confidenceLabel` and `bandFor` are called only from `buildTickRecord`.

## Post-review amendments (re-audit of the implemented v39.6 change)

- Qualifier format (blocking bug): the real USGS feed gives each value's `qualifiers` as plain strings. The new Difficult Run parser accepts both forms and drops empty codes; before this, `qual` came out as `["undefined"]` and an Ice qualifier was never detected. The test mock now builds Difficult Run qualifiers as strings by default; a real response is committed as `test/fixtures/usgs-difficult-run-real.json` and parsed in a test, plus a real-format Ice test.
- The same mistake in the existing `fetchUSGSData` is NOT fixed (it decides ice and suspends learning, so fixing it changes the estimate path). Recorded as TODO A12, an owner decision.
- Three surviving mutants now fail tests: `conf.freshLoad` computed with a non-null Edwards Ferry trend; the estimate reading `hTail` (a test with the last raw EF reading invalid); `attachDr` adding `dr` to non-claimed rows.
- Docs: the appendix `v`=1 line corrected; section 6.10.1 gains the ice-tick, advisory-state, `ms` and unverified-until-production notes. Test count: 1223 (1221 pass, 2 opt-in skips).

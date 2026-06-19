# #12 — Parallelize loadGFLearningData SELECTs (test-first) — Plan

**Date:** 2026-06-19
**File:** `netlify/functions/sync-learning.js` (load-bearing → Code-Change Verification Protocol applies)
**Goal:** Collapse the 5 sequential, independent SELECTs in `loadGFLearningData` ([L325](../netlify/functions/sync-learning.js#L325)) into one `Promise.all`, shaving ~100–400ms off the cold-load critical path (this endpoint is `await`ed in `init()` before the first GF estimate paints). **Behavior-equivalent — no output change.** De-risked by writing characterization tests FIRST (the file currently has zero DB-site coverage).

## Why test-first
`sync-learning.js` has no test net for its DB functions. The refactor's only risk is breaking the **asymmetric error semantics**:
- `bins` (gf_correction_bin) and `pending` (gf_prediction/pending) → `if (err) throw` → caught → **500**.
- `metadata`, `efCorrelation`, `shadowLeaderboard` (all `.single()`, gauge_id='system') → errors **tolerated** via optional chaining (missing row → default/null).
- The `catch` returns a fixed body `{error:'Failed to load GF learning data'}`, so error *precedence* is not observable — only "throws-500" vs "tolerated" matters.
Characterization tests lock these in, pass against the CURRENT sequential code, then must still pass after the refactor → proves equivalence.

## Step 1 — Make it testable (safe)
Add `loadGFLearningData` to the existing test-export:
`exports._test = { buildForecastRows, validateGFWritePayload, loadGFLearningData };`
(One-line; no logic change. `loadGFLearningData(client)` already takes the client as a param.)

## Step 2 — Test file `test/sync-learning-loadgf.test.js` (new)
A reusable mock Supabase client supporting the chain `from().select().eq().eq().order().limit()` (thenable) and `.single()` (thenable), returning a scripted `{data, error}` per `observation_type`. Cases:
1. **Happy path** — all 5 return data → response has built correctionBins (via `buildCorrectionBins`), pendingPredictions (spread `data` + `created_at`), metadata, efCorrelation, shadowLeaderboard. statusCode 200.
2. **binErr → 500** (bins query returns `{error}`).
3. **pendErr → 500** (pending query returns `{error}`).
4. **metadata missing** (`.single()` → `{data:null, error:notFound}`) → tolerated; response uses the default metadata object `{totalValidations:0, totalPredictions:0, avgErrorPercent:null, lastValidation:null}`. statusCode 200.
5. **efCorrelation missing** → `efCorrelation:null`, statusCode 200.
6. **shadowLeaderboard missing** → `shadowLeaderboard:null`, statusCode 200.
7. **efCorrelation sumCFSSq heal** — efCorr with a `points[]` array → response's `efCorrelation.sumCFSSq` equals `Σ cfs²` recomputed from points (the on-load legacy-bug heal at L392-401).
8. **pending mapping** — a pending row `{data:{...}, created_at}` → appears in `pendingPredictions` with `created_at` merged in.

Run: must PASS against the current sequential implementation.

## Step 3 — Refactor `loadGFLearningData`
Replace the 5 sequential `await client.from(...)...` with:
```js
const [binsRes, pendRes, metaRes, efRes, shadowRes] = await Promise.all([
    client.from('potomac_observations').select('gauge_id, data').eq('observation_type', 'gf_correction_bin'),
    client.from('potomac_observations').select('gauge_id, data, created_at').eq('observation_type', 'gf_prediction').eq('gauge_id', 'pending').order('created_at', { ascending: false }).limit(50),
    client.from('potomac_observations').select('data').eq('observation_type', 'gf_metadata').eq('gauge_id', 'system').single(),
    client.from('potomac_observations').select('data').eq('observation_type', 'ef_gf_correlation').eq('gauge_id', 'system').single(),
    client.from('potomac_observations').select('data').eq('observation_type', 'shadow_leaderboard').eq('gauge_id', 'system').single(),
]);
const { data: bins, error: binErr } = binsRes;
if (binErr) throw binErr;
const { data: pending, error: pendErr } = pendRes;
if (pendErr) throw pendErr;
const { data: meta } = metaRes;
const { data: efCorr } = efRes;
const { data: shadowLB } = shadowRes;
```
Then the existing assembly (buildCorrectionBins / pendingPredictions map / return body / sumCFSSq heal) is **unchanged**. The `try/catch` wrapper is unchanged.

- Supabase query builders are thenables that resolve to `{data,error}` (never reject), so `Promise.all` resolves with all 5 results; explicit `throw binErr/pendErr` preserves the 500 semantics. Error *precedence* unchanged (binErr checked first); not observable anyway (fixed catch body).
- **Known minor diff (acceptable):** on an error, all 5 queries now run (vs sequential short-circuit). Extra DB load only on the error path; response identical. Noted for the auditor.

Run: the Step-2 tests must STILL pass → equivalence proven. Plus full `npm test` + `npm run build`.

## Version / docs
MINOR? No — this is a server-only latency optimization with **no output change**. Per the versioning rule it's a perf/internal change; I'll bump **MINOR v37.4 → v37.5** (server behavior/perf change, like v37.2 cron fix was MINOR) and add CHANGELOG/README/tech-appendix/CLAUDE.md/index.html entries. (Open question for the auditor: bump or treat as no-op-internal? Leaning MINOR for traceability since runtime behavior/timing changes server-side.)

## Audit engagement (independent auditor, 2026-06-19)

Verdict: safe to implement, two must-fixes. Dispositions:
- **Must-fix 1 (test) — ACCEPTED.** Happy-path case feeds a realistic bins row
  `[{gauge_id:'6000-12000_steady', data:{count, emaMeanError|meanError, ...}}]` and asserts the matching
  `correctionBins` cell is populated (a `[]` bins input would pass trivially and prove nothing).
- **Must-fix 2 (mock) — ACCEPTED.** Mock records `observation_type` from the `.eq()` args (the 5 types are
  distinct, so that uniquely keys each query); exposes a thenable terminal (bins awaited after `.eq`, pending
  after `.limit`) AND `.single()` (meta/efCorr/shadow). Reuse the proven builder idiom in
  `test/scheduled-update.test.js:807-827` (order/single/then) rather than a fresh design.
- **Cold-start case — ACCEPTED.** Add: bins/pending return `{data:null}` (no error) → empty 18-bin scaffold +
  `pendingPredictions:[]`, statusCode 200.
- **Error semantics, Promise.all equivalence, `_test` export safety, concurrency — RESOLVED by auditor**, no change.
- **Version — MINOR v37.5.** Auditor leaned no-bump (no observable change) but noted the project's every-change
  convention + v37.3 precedent (behavior-neutral refactor logged MINOR). This touches real server runtime code
  (unlike #13 JSDoc, comments stripped from the build → no bump), so bump MINOR for traceability. Not MAJOR.
- **Note (auditor):** `npm run build` is the Vite *client* build and does NOT bundle `netlify/functions/`, so
  the build step won't exercise this server change — the characterization tests are the real gate. Will still
  run build (proves client untouched) but rely on `npm test` for the server behavior.

## Risks / open items for auditor
1. Does the mock faithfully represent the supabase-js chain (thenable builder + `.single()`), so a green test actually means the real code path works?
2. Are the 8 cases sufficient to lock the asymmetric error semantics + the sumCFSSq heal?
3. Is the `Promise.all` rewrite truly behavior-equivalent (error precedence, the metadata/efCorr/shadow tolerance, the `.single()` results)?
4. Version bump: MINOR v37.5, or no-bump internal?
5. Any concurrency caveat (supabase-js firing 5 concurrent fetches from a Netlify function — connection limits)? Expected fine (undici pools), but flag if known issue.

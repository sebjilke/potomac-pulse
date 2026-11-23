# R8a: the prediction path across the three server versions that ran in the window

Commits: v39.2 = f760635 (10 Nov 15:16 EST), v39.6 = 20ed8d8 (10 Nov 17:21 EST), v39.11 = cd7b0c3 (17 Nov 11:12 EST).
Exports: `code/v39.2/`, `code/v39.6/`, `code/v39.11/` (`netlify/functions` tree of each commit, from `git archive`).
Runs by version in the job log: v39.2 rows 1 to 2 (10 Nov 21:00 and 22:00), v39.6 rows 3 to 191 (to 17 Nov 16:00),
v39.11 rows 192 to 305 (from 17 Nov 17:01:02, `src` = `new` on all of them).

Method: function bodies were cut out by name (text from `function NAME(` to the closing brace at column 0) and compared
byte for byte with `diff`/MD5; the main handler's steps 1 to 3 (fetch, store history, load history), the ice-flag block and
step 5 (make the prediction) were compared the same way. "Prediction path" = everything between the USGS request and the
`makeGFPrediction` return value, plus the history store.

## Answer in two lines

1. The model code is identical in all three versions: `makeGFPrediction`, `storePoRHistory`, `getPoRFromHistory`, `loadCorrectionBins`, the handler's history and predict steps, and all of `shared/model.js` (MD5 59ee150b... in all three, and at HEAD) are byte-identical.
2. What changed is only how the readings arrive: v39.6 adds a log-only Edwards Ferry tail inside `fetchUSGSData`; v39.11 adds the new-service request and adapter in front of the same parsers (and a `meta` out-parameter that nothing in the estimate reads). No commit after cd7b0c3 changed `scheduled-update.js`, `shared/model.js` or `shared/observations.js`.

## Function by function

| function / file | v39.2 vs v39.6 | v39.6 vs v39.11 |
|---|---|---|
| `shared/model.js` (every helper `makeGFPrediction` calls: `getFlowMultiplier`, `getPoRtoGFTravelTime`, `getGFtoLFTravelTime`, `selectHistoricReading`, `medianCfs`, `getPoRRiseRateFromHistory`, `getFlowState`, `getEFWeight`, `applyGFCorrection`, `getGFCorrectionInterpolated`, `estimateLFStage`, constants) | identical (MD5 59ee150bf8294bd7b835aa84fccb64d8) | identical |
| `shared/observations.js` (`getObs`, `upsertObs`, used by the history store) | identical (MD5 02149497...) | identical |
| `makeGFPrediction` | identical | identical |
| `getPoRFromHistory` | identical | identical |
| `storePoRHistory` | identical | identical |
| `loadCorrectionBins` | identical | identical |
| `validateUSGSResponse` | identical | identical |
| handler steps 2 to 3 (store history, load stored history, `fullHistory`) | identical | identical |
| handler ice flags (`criticalIce`) and step 5 (the call `makeGFPrediction(usgsData, fullHistory, waterTempC, correctionBins, trace)`) | identical | identical |
| `fetchUSGSData` parsing (current value, `qTime`, `hTime`, ice test, PoR `history` map and filter) | identical except the added block below | parsing identical; request stage changed (below) |
| `fetchWithTimeout` | identical | signature and body changed (below) |
| `fetchWaterTemp` | identical | request stage changed (below); parsing identical |
| `usgsRequest`, `fetchJsonCapped`, `redactKey`, `fetchNewIvJson`, `shared/usgs-adapter.js`, constants `USGS_MAIN_TIMEOUTS_MS`, `USGS_SINGLE_TIMEOUT_MS` | do not exist | new in v39.11 |
| `require('./shared/ci-table')` and `bandFor` | new in v39.6 (log only: `tick_log.ci`) | same |

## Every difference, quoted

### v39.2 to v39.6, `fetchUSGSData` (one added block, log only, assigned after the values the model reads, in its own try/catch)

```
+                // v39.6 (A5/A8): raw copy of the last 16 Edwards Ferry stage readings for the audit log
+                // ONLY. Plain numbers, in its OWN try/catch, assigned last, so a failure leaves the
+                // field absent and can never reach the estimate. Nothing derived is computed here
+                // (the 1 h trend is computed in buildTickRecord). makeGFPrediction never reads it.
+                if (siteId === gauges.ef && param === '00065') {
+                    try {
+                        data[siteId].hTail = values.slice(-16).map(v => ({ t: new Date(v.dateTime).getTime(), v: parseFloat(v.value) }));
+                    } catch (_) { /* log-only copy; never affects the estimate */ }
+                }
```

Also in the file head: `+const { bandFor } = require('./shared/ci-table');` (logging only). Log builders (`buildTickRecord` and others) changed; they sit after the prediction and are not part of it.

### v39.6 to v39.11

`fetchWithTimeout` (used only on the old-service path now):
```
-async function fetchWithTimeout(url, timeoutMs = 5000) {
+async function fetchWithTimeout(url, timeoutMs = 5000, headers = null) {
-        const response = await fetch(url, { signal: controller.signal });
+        const response = await fetch(url, headers ? { signal: controller.signal, headers } : { signal: controller.signal });
```
`fetchUSGSData`:
```
-async function fetchUSGSData() {
+async function fetchUSGSData(meta = null) {
...
+        let json;
+        const src = usgsRequest({ sites: Object.values(gauges), params: ['00060', '00065'], period: 'P2D', oldUrl: url });
+        if (meta) meta.src = src.source;
+        if (src.source === 'new') {
+            json = await fetchNewIvJson(src, USGS_MAIN_TIMEOUTS_MS, meta);
+            if (!json) return null;
+        } else {
+            (the old fetch, ok-check and JSON parse, unchanged, now inside the else branch)
+        }
```
`fetchWaterTemp`:
```
+        let json;
+        const src = usgsRequest({ sites: ['01638500'], params: ['00010'], period: 'P1D', oldUrl: url });
+        if (src.source === 'new') {
+            json = await fetchNewIvJson(src, USGS_SINGLE_TIMEOUT_MS);
+            if (!json) return null;
+        } else {
+            const response = await fetchWithTimeout(url, 5000);
+            if (!response.ok) return null;
+            json = await response.json();
+        }
```
Handler step 1: `+const usgsMeta = {};`, `+tickCtx.usgsMeta = usgsMeta;`, `fetchUSGSData()` becomes `fetchUSGSData(usgsMeta)`.
New: `shared/usgs-adapter.js` (`toLegacyIv` turns the new service's rows into the old structure: statistic 00011 only, rows sorted by time, `null` to `"-999999"`, `P`/`A` from `approval_status`, qualifier map `ICE`->`Ice`, `EQUIP`->`Eqp`), with the same `dateTime` string (new service `time`) so `new Date(v.dateTime).getTime()` yields the same epoch ms. Request window: old service `period=P2D`, new service `time=P2D`, both "last 48 hours".

## After cd7b0c3

`git log cd7b0c3..HEAD -- netlify/functions`: d015ed2 (v39.13) and 2781168 (v39.12). Net change to the files under study: `shared/usgs-adapter.js` gains two comment lines (`// --- BEGIN SHARED ---`, `// --- END SHARED ---`); two new files (`shared/usgs-sets.js`, `usgs-proxy.mjs`) that the hourly job does not load. `scheduled-update.js`, `shared/model.js` and `shared/observations.js` at HEAD have the same MD5 as at cd7b0c3. `SERVER_VERSION` stays v39.11.

## What this means for the replay (facts, not results)

The prediction arithmetic is one code body; the replay imports each run's own version anyway (v39.2 for rows 1 to 2, v39.6 for rows 3 to 191, v39.11 for rows 192 to 305). Runs before the switch go through the old-service branch (`usgsRequest` absent in v39.2 and v39.6; in v39.11 only `src = new` runs exist in the log), runs from 17 Nov 17:01 UTC go through `usgsRequest` -> `fetchNewIvJson` -> `toLegacyIv`.

Adapter markers (audit finding 14): at HEAD `shared/usgs-adapter.js` differs from cd7b0c3 only by the two comment lines `// --- BEGIN SHARED ---` and `// --- END SHARED ---` (added in v39.12/v39.13 for the browser copy; the job kept logging `v39.11`); no functional change.

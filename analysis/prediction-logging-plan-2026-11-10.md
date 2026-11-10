# A3 plan: audit logging for the hourly cron (target next free minor, currently v39.2, MINOR, server-only)

Status: REVISED after the independent plan audit (CLAUDE.md protocol step 3). This file is the final specification. Not implemented. The last section, "Audit response", lists what was accepted and why.
Date: 2026-11-10. Line numbers are in `netlify/functions/scheduled-update.js` ("S") unless stated. They were read on this date and the implementer must re-check them, because the file may drift.

## 1. Problem

The October 2026 flood audit could not be done from stored data. Only one pending prediction is stored at a time, so 66 hourly rising-limb predictions left 7 records. Clean validations keep 7 days with no raw value, stages or flags. Scored forecast rows are deleted. Correction bins and the shadow leaderboard have no history. Discharge reading times are thrown away in `fetchUSGSData` (S:258-277 keeps `dateTime` only for stage as `hTime`), so gauge latency had to be fitted in-sample. A run that makes no prediction (ice, null input, failed insert) returns 200 and pings green (S:2301).

Goal: the next event can be audited from stored rows alone. Estimation must not change.

## 2. Design in one paragraph

Four new append-only `observation_type` values in the existing table, no migration:
- `tick_log`: one row per cron run, including runs with no prediction and runs that threw.
- `validation_log`: one row for every logged fate of a pending prediction row (validated, hard-flagged, or lost for any reason).
- `bin_snapshot`: a daily snapshot of all correction bins and the shadow leaderboard.
- `log_health`: one upserted counter row, written only on failures.

A pure builder makes each record. A non-fatal writer with a cumulative time budget inserts it. A daily bounded prune removes only the three append-only types past their retention. Model internals come out through an optional `trace` out-parameter on `makeGFPrediction`, so the returned object is untouched. The read path is database-only (SELECT). No new public endpoint.

## 3. Files and changes

| File | Change | Why |
|---|---|---|
| `netlify/functions/scheduled-update.js` | (a) `fetchUSGSData`: add `qTime` (epoch ms of latest discharge reading) next to `q`, same place `hTime` is set. (b) `fetchWaterTemp(out = null)`: optional out-parameter, sets `out.t = latest.dateTime` epoch ms; return value unchanged. The handler passes a local object (see 5.2). (c) `makeGFPrediction(..., correctionBins, trace = null)`: fill `trace` with primitives copied from already-computed locals; also extend the S:889 destructure to include the correction's unclipped value if `applyGFCorrection` returns it (it does, `correctedFinalUnclipped`, M:720). (d) `const SERVER_VERSION`. (e) `buildTickRecord`, `buildValidationRecord`, `buildBinSnapshot`, `LogBudget`, `writeLogRow`, `pruneLogType`, `LOG_RETENTION_DAYS`. (f) handler: `tickStartMs` and `tickCtx` declared BEFORE the `try` (see 5.2); `tickCtx` filled progressively; success ping first, then housekeeping and one tick write; error row in `catch` after the `/fail` ping. (g) `storePrediction` returns a status string instead of void. (h) `storeValidationPair` (S:405) returns a status (`written`, `deduped`, `error`) instead of void. (i) `validatePendingPredictions`: one `validation_log` row per logged fate (section 6). (j) export new helpers in `_test`. | All L1-L4 work. The model pair is not touched. |
| `netlify/functions/shared/model.js` | NONE. | `makeGFPrediction` lives in S, not in M. |
| `netlify/functions/sync-learning.js` | NONE (a test asserts it does not mention the new types and that every delete there carries an `eq` on a non-log type). | No new public endpoint. |
| `src/**` | NONE. | Server-only. Another team is editing `src/` now. |
| Tests | New files listed in section 12. Existing tests are not edited, except where section 12 says a test file must be checked for a changed return type (`storeValidationPair`, `storePrediction`): if an existing test asserts `undefined` from them, STOP and report; do not edit it. | L7. |
| Docs | Section 14. Sequenced after the other team finishes. | Versioning Rules. |

## 4. How each missing L1 field is obtained, and why the estimate cannot change

Today `makeGFPrediction` returns 24 fields (S:898-923). Fields needed by L1 that it does not return: Broad Run and Seneca flows, tributary fallback flags, PoR to GF travel (initial and final), iterations, stop reason, multiplier, PoR rise rate, pre-delta estimate, delta pct/decay/ratio, EF discrepancy and skip, correction unclipped, exact ceiling value, input reading times.

Chosen route: an optional 5th parameter `trace`, default `null`. Inside the function, each addition is `if (trace) trace.x = <local that already exists>`.

Rules (these are binding):
1. `trace` holds primitives only (numbers, booleans, strings, null). Never an object or array reference from model state (`usgsData`, `fullHistory`, `binData`, `prediction`, `historicPoR`). Copy the number out.
2. `trace` is write-only. Nothing in the model reads it. With `null` the new lines are skipped.
3. The `return` statement is not edited. Control flow is not edited. No new arithmetic feeds `estimatedCFS`.
4. One new local: `stop`, a string set at the existing exits of the travel loop: `converged` at the convergence `break` (S:795-799 region), `no_hist` when `historicPoR` is null and the loop ends, `max_iter` when the pass cap ends it. The implementer must read the loop and map the existing exits; the S:795 `break` that is NOT convergence must not be labelled `converged`. `it` is the number of passes executed. `stop` is never read by model code.
5. `corr.unc` (correction applied value before the ceiling): either read `correctedFinalUnclipped` from the existing S:889 destructure (a one-line edit to the destructure, declared here as the only edit to an existing line) or log `rawFinalUnclipped - correction`. Prefer the destructure; assert equality in T2.
6. Builders (`buildTickRecord` and the others) never write to their inputs. They read, round into new objects, and return.
7. `fb` (tributary fallback) is `!gauge?.q` computed at S:806-809 from the same expression the model uses; if the model has no local for it, the trace computes it from the same inputs without touching them.

Why the estimate cannot change: the return object is built from the same expressions; `trace` is write-only; T1 deep-equals output with and without trace on every fixture, with `usgsData`, `fullHistory` and `correctionBins` deep-frozen so an accidental write throws; the characterization, golden, parity and travel-time tests run unmodified and `git diff --stat` on them must be empty at the final audit.

Why not return the fields: they would flow into the stored pending row (S:1781) and the JSON the client reads, and widen the surface the parity tests compare. Why not recompute in the handler: duplicated model math can drift from the real one.

`qTime` is additive on `usgsData.data[site]`. The implementer must grep every test for `deepEqual` on `fetchUSGSData` output (a grep of characterization, ensemble-parity and scheduled-update tests found none) and run the full suite.

## 5. Per-tick record: `tick_log`

### 5.1 Row identity

`observation_type = 'tick_log'`, `gauge_id = new Date(tickStartMs).toISOString()` (full millisecond precision, fixed width, for example `2026-11-10T14:00:03.412Z`). Insert, not upsert. Millisecond precision keeps the second of two overlapping runs (the F2 skip-guard shows overlaps happen, and a double-claim audit needs that row). A unique violation (code `23505`) is treated as `dup`, not as a failure, and is not counted in `log_health`.

### 5.2 Context object and where it lives

- `tickStartMs = Date.now()` and `tickCtx = {}` are declared BEFORE the `try` (just after the `!client` check at S:2105-2108). `runStartMs` (S:2112) stays exactly where it is, so the F2 skip-guard marker does not move.
- `tickCtx` is filled progressively: `tickCtx.stage` (`fetch`, `store_history`, `validate`, `predict`, `store`, `housekeeping`), `tickCtx.usgsData`, `tickCtx.waterTempC`, `tickCtx.tempT` (from the `fetchWaterTemp` out-parameter), `tickCtx.fullHistory`, `tickCtx.trace`, `tickCtx.prediction`, `tickCtx.slot`, `tickCtx.val`, `tickCtx.adv`, `tickCtx.ice`. The builders read from it.
- `tickCtx` holds references; the builders must not mutate them (rule 6, section 4). T4 deep-freezes `usgsData`, `prediction`, `trace` and `fullHistory` before calling the builders.
- Limitation, documented: the pre-`try` `Supabase not configured` return (S:2105) cannot be logged, because there is no client. The Netlify log line is the only record.
- The catch path fills `at` and `in.*` from whatever `tickCtx` has by then. `why` comes from `tickCtx.stage` (for example `usgs_fetch_failed` when the thrown error is the S:2124 throw and stage is `fetch`), `out = 'error'`.

### 5.3 Fields

Numbers rounded to 1 decimal unless noted. Target size 2.0 to 2.6 KB. `lf`, `por` etc. are `usgsData.data[usgsData.gauges.<name>]`. `T` = trace field.

| Field | Type | Source | Why an auditor needs it |
|---|---|---|---|
| `v` | int | const `LOG_SCHEMA = 1` | Decode old rows after format changes |
| `ver` | string | const `SERVER_VERSION` | Which code made the row (rules changed v37.20, v37.21, v39.0) |
| `commit` | string/null | `process.env.COMMIT_REF ?? null` | Catches a stale hand-maintained `SERVER_VERSION`. Verify it is non-null on the first live row |
| `at` | ISO | `new Date(tickStartMs).toISOString()` | Tick time; gaps in `at` = missed runs |
| `out` | string | `predicted`, `no_prediction`, `error` | Separates the three exits |
| `why` | string/null | `ice_skip` (S:2149), `null_lf_or_por` (recomputed in handler from `lf?.q`, `por?.q`, matching S:780), or on `error` the `tickCtx.stage` name | Reason for NO prediction (L1) |
| `err` | string/null | `String(e.message).slice(0,200)`, catch only | No stack, no env |
| `ms` | int | `Date.now() - tickStartMs` at write time | First tick duration data that exists |
| `in.lf`, `in.por` | `{q,qT,h,hT}` | `.q, .qTime, .h, .hTime` | The truth gauge and the main input, with age |
| `in.mono`, `in.goose`, `in.br`, `in.sen` | `{q,qT,fb}` | `.q`, `.qTime`; `fb` per rule 7 | Value, age, and whether the drainage-area fallback replaced a missing reading |
| `in.ef` | `{h,hT}` | `ef.h, ef.hTime` | EF stage and age (EF advisory uses a 2 h age rule) |
| `in.tC`, `in.tT` | num/null, epoch ms/null | `waterTempC`; `tickCtx.tempT` from `latest.dateTime` | Selects cold or default EF model, and the reading's age (L1 requires a time for every input) |
| `in.ice` | `{lf,por,efMiss}` | S:2140-2142 | Why learning was suspended |
| `in.porHist` | `{n,firstT,lastT}` | `fullHistory` length, first and last `timestamp` (copied numbers) | Which PoR history the tick had |
| `rise` | `{r,rst}` | T: `porRiseRate.ratePerHour` (may be null), `porRiseRate.flowState` (S:789) | Input to travel time. Named `rst` so it is not confused with `corr.st` |
| `trv` | `{t0,t,it,stop,mult,nohist}` | T: first and final `travelPoRtoGF`, passes executed, `stop` in `converged`/`no_hist`/`max_iter`, final `mult`, `historicPoR === null` | 22 of 54 rising ticks did not converge; travel was the rising-limb mechanism |
| `trv.gf2lf` | num | `travelGFtoLF` (S:803) | Validation timing |
| `hist` | `{cfs,ago,ts}`/null | `historicPoR.cfs`, `.actualHoursAgo`, and the selected reading's timestamp | The time-shifted PoR value, its true age, and which reading it was |
| `pre` | `{cfs,shifted}` | T: `preDelta` = `historicPoR.cfs` + 4 tributary flows before the PoR-delta; `shifted` = true when `historicPoR` was non-null, false when the unshifted PoR reading was used | Pre-delta estimate (recession split needed it). Not called "por.shift" because it is not always shifted |
| `delta` | `{pct,decay,ratio,on}` | T: `porChangePct`, `decayFactor`, `appliedRatio`, `Math.abs(porChangePct) > 5` | PoR-delta component |
| `por.est` | num | `porEstimateCFS` after delta, unrounded | Existing field |
| `ef` | `{est,type,w,used,disc,skip}` | `efEstimateCFS`, `efModelType`, `efWeightUsed`, `useEfEnsemble`, T: `discrepancy`, `discrepancy > 0.50` | EF component, blend weight, and the >50% skip |
| `raw` | `{cfs,stage}` | `rawFinalUnclipped` (1 dp), `estimateLFStage` | The missing raw series |
| `corr` | `{bin,st,c,unc}` | `flowBin`, `flowState`, `correction`, T: unclipped corrected value | Correction in force. T2 asserts `corr.st === prediction.flowState` |
| `ceil` | `{lim,bound}` | T: `lf.q * CEILING_RATIO`, `ceilingApplied` | Exact ceiling and whether it bound |
| `final` | `{cfs,stage,ts}` | `predictedCFS`, `predictedStage`, `prediction.timestamp` (S:899, already in the pending row) | What the app computed. `ts` is the join key to `validation_log.predTs` |
| `due` | ISO | `validationDue` | For offline scoring |
| `adv` | `{dbar,ef,lfr,lfe}` | `divergenceState.dbar/.active`, `lfResidualState.active/.lastErrPct` (S:2193, 2228). Present on no-prediction ticks too | Banners active |
| `slot` | string | `storePrediction` status: `stored`, `skipped_in_window` (S:1772), `replaced` (S:1777), `insert_failed` (S:1783), `none` | Which ticks fed validation |
| `val` | `{n,cleaned}` | `validated`, `cleaned` | Validation activity this tick |
| `aux` | object | snapshot result, prune result (candidates, deleted, errors), and `logFail`: an array of `{type, predTs?, reason}` for every log write that failed or timed out THIS tick (including `validation_log` writes) | Proves housekeeping ran; makes a lost validation row visible from the tick row (PA-21) |

No-prediction record: same row; `out='no_prediction'`, `why` set, `in.*`, `adv`, `val` filled, all model fields null. Thrown run: `out='error'`, `err` set, `in.*` filled if the fetch completed.

`storePrediction` already reads the slot (S:1760); it returns the status it already computes. No extra DB read.

## 6. Validation record: `validation_log` (L2)

### 6.1 One row per logged fate (`claim_failed` is not terminal: the pending row stays)

Row: `gauge_id = <valAt ISO ms>_<pred.id>` (unique, sortable by prefix). A row is written for EVERY way a pending row leaves the slot, not only claimed validations. `outcome` is exactly one of:

| outcome | Where | Notes |
|---|---|---|
| `validated` | claimed, clean or soft-flagged, learning ran | normal |
| `hard_flagged` | claimed, hard flags, learning skipped | normal |
| `bin_read_failed` | claimed, then bin read failed so learning was skipped | existing early-continue |
| `stale_deleted` | S:985 stale cleanup | age and `created_at` recorded |
| `bad_due_deleted` | S:1000 invalid `validationDue` cleanup | |
| `replaced_missed_window` | `storePrediction` S:1777 replacement; use `existing.data` (read at S:1762) as the record source | |
| `claim_failed` | S:1130-1133 delete error on claim | |
| `claim_lost` | S:1134-1137 zero rows claimed (another run won) | the double-claim audit row |

The implementer must enumerate every `continue` and `return` inside the pending loop and `storePrediction` and map each to one of these values. If one does not fit, add a value and list it in the Tech Appendix. T9 covers every value.

Rows for the non-learning fates carry only the common fields (`predId, predTs, predAt, dueAt, valAt, outcome, ver`, and what is available of `rawCFS, corrCFS, bin, st, flags`). They are small (about 0.4 KB).

### 6.2 When the row is written

At the END of the iteration for claimed rows, after shadow scoring and before `pairs.push` (S:1735). This is after the bin, metadata, pair and leaderboard writes, so `binAfter`, `pairStored` and the leaderboard are known. Each early-continue path writes its own row just before the `continue`. The write is non-fatal and does not alter control flow, so learning results are identical whether the log write succeeds or fails (T9).

The existing `validation_failure` rows and `gf_validation_history` are kept exactly as they are.

### 6.3 Fields for claimed rows

- Identity and version: `v, ver, commit, gateVersion, outcome, predId, predTs` (= `pred.data.timestamp`, the join key to `tick_log.final.ts`), `predAt` (`pred.created_at`), `dueAt`, `valAt`, `delayMin`.
- Values: `rawCFS, corrCFS, corrApplied, actualCFS, lfAtPred` (`pred.data.lfCFS`), `errRawCFS, errPctRaw, errPctCorr`.
- Truth timing: `actualT = lf.qTime`, `actualStageT = lf.hTime` (the reading times of the LF truth value; the October replay had to fit a 10 min lag plus 65-70 min overrides).
- Stages: `rawStage` (pred `rawFinalStage`), `predStage` (corrected, named so the C7 confusion cannot recur), `actualStage, errStage`.
- Bin and flags: `bin, st`, `hard, soft, hardScore, softScore, flags[]` (full strings), `z` (outlier z or null).
- Learning gate flags: `learned` (bin updated), `binReadFailed`, `binWriteFailed`, `stageBinWriteFailedKey` (key string or null), `accuracyCounted`.
- Bin state: `binBefore {n, ema, sd}` and `binAfter` for the flow bin and for the stage bin. `binBefore` is copied as plain numbers BEFORE `updateCorrectionBin`, because `binData` is mutated in place (S:1275). `binAfter` is the FULL stored bin object as written (a copy), or `null` when the write failed. The stage-bin locals are block-scoped (S:1311-1354); the implementer declares a loop-scope capture variable (`stageCap = {before:null, after:null, key:null}`) before the block and assigns into it, without moving learning code. T9 asserts the captured stage values equal the stored stage bin.
- `lb`: the post-update shadow leaderboard (about 1 KB) when it was written this iteration (S:1719 region), else absent.
- Stamps: `ceilBound` (pred `ceilingApplied`), `efDiv, divActive, lfResActive, lfResErr`, `tC`, `pairStored` (from the `storeValidationPair` status; `deduped` when the 30-min dedupe at S:430 skipped it).

About 2.9 KB with `lb`, 1.9 KB without.

If a variable needed for `binBefore` is not in scope without editing learning code, store `binAfter` only and say so in the Tech Appendix. Learning code is not otherwise touched.

## 7. Snapshots: `bin_snapshot` (L3)

Row: `gauge_id = <YYYY-MM-DD>T03:00:00.000Z` (the day's key, whichever run writes it). Data: all rows of `gf_correction_bin` as `{key: {n, ema, mean, sumSq?, sd}}`, plus `shadow_leaderboard/system` data, plus `ver`. Today that is 28 bin rows (18 flow bins, the rest `stage_*`), about 7.4 KB.

Attempt schedule: the tick whose UTC hour is 3 attempts the snapshot. Ticks at hours 4 and 5 first check whether the day's row exists (one `select id` on the unique key) and write it only if missing. A `23505` on insert counts as success (`dup`). This gives three chances a day and makes re-runs harmless. Cost on a normal day: 2 reads + 1 insert at hour 3; 1 existence read at hours 4 and 5.

### Recovery rule (state at time T)

For bin K and time T, take the NEWER of:
- (a) the last daily snapshot with key <= T, and
- (b) the `binAfter` of the last `validation_log` row for K with `valAt <= T` and outcome `validated` or `hard_flagged`.

Then apply a continuity check along the validation rows after the snapshot: each row's `binBefore.n` must equal the previous row's `binAfter.n` (or the snapshot's `n` for the first row). A break means an admin reset (see the existing `audit_log` row) or a lost log row; in that case state is only known from the next snapshot, and the auditor must say so. Do not prefer (b) blindly: after an admin reset the old `binAfter` is wrong.

Leaderboard at time T: the `lb` of the last `validation_log` row with `valAt <= T` that carries `lb`, or the last snapshot, whichever is newer. This meets L3 ("state at any past time") up to log-write failures, which are visible in `log_health` and `tick_log.aux.logFail`.

Rejected: hourly full snapshots (65 MB/yr for no gain over validation deltas plus a daily snapshot).

## 8. Storage shape, retention, arithmetic (L2, L3)

Per-row sizes are estimates from the live table (pending row, 29 keys, 684-922 B; bin rows avg 166 B across 28 rows; leaderboard 1,064 B; the unique key and four other indexes add about 0.35 KB per row). Not measured for the new types.

Rate note: there is one pending slot, so validations are capped at about 24 / travel-time hours. At 19 h median travel that is about 1.3 a day, and the October flood showed 1.5 to 4 a day. The old "24 max" figure was impossible. The worst-case column below keeps 24 a day as a deliberately conservative bound.

| Type | gauge_id | Rows/day | Row size (central, range) | Retention | Steady state (realistic) | Conservative bound |
|---|---|---|---|---|---|---|
| `tick_log` | tick start ISO ms | 24 | 2.4 KB (1.5-3.3) | 180 days | 4,320 rows, 10.4 MB | 14 MB |
| `validation_log` | valAt ISO + `_` + id | 1.5 to 4 realistic | 2.9 KB claimed / 0.4 KB other fates | 730 days | 1,100-2,900 rows, 3-9 MB | 17,520 rows, 52 MB |
| `bin_snapshot` | day ISO at 03:00Z | 1 | 7.4 KB | 730 days | 730 rows, 5.4 MB | 6 MB |
| `log_health` | `system` | one row | under 1 KB | none | 1 row | 1 row |
| Total | | | | | about 19-25 MB | about 72 MB |

Arithmetic: 24 x 180 = 4,320; 4,320 x 2.4 KB = 10.4 MB. 730 x 7.4 KB = 5.4 MB. Validation: 4 a day x 730 = 2,920 rows x 2.9 KB = 8.5 MB. Bound: 24 x 730 = 17,520 x 3 KB = 52 MB.

Context: the database is about 100 MB now (this table 0.95 MB). The Free-plan limit is 500 MB on the pricing page and 2 GB on the disk page (they disagree; 500 MB treated as binding). The conservative bound 72 MB is about 14% of 500 MB. Re-measure with `pg_column_size` after 7 days and move retention if the estimate was off by more than 2x.

Retention reasons: ticks 180 days cover a full flood season and are cheap; 365 days would cost about 10 MB more if wanted. Validations and snapshots are the scored truth and the cheapest, so 730 days.

## 9. Writing, failure handling, counters (L4)

### 9.1 Cumulative budget (replaces the single wall deadline)

`LogBudget` is created once per run. It tracks time actually SPENT inside log writes (sum of elapsed time per write), not a wall deadline from run start. Two pools:
- `general`: 3000 ms, used by `validation_log`, `bin_snapshot`, prune and `log_health` writes.
- `tick`: 3000 ms, reserved. Only the `tick_log` insert (success path and error path) may draw from it. Validation, snapshot and prune writes cannot use it.

A slow or hanging validation write can therefore exhaust `general` but cannot stop the tick row from being attempted. Slow ticks are the ones an audit needs most.

### 9.2 `writeLogRow(client, type, gaugeId, data, budget, pool)`

1. If the pool is spent (remaining <= 0), return `{ok:false, reason:'budget'}` without calling the database.
2. `insertObs(...)` raced against a timer of `min(2000, remaining)` ms, timer cleared in `finally`. A hung request cannot hold the run. The request is not cancelled, only abandoned. The elapsed time is added to the pool.
3. Whole body in try/catch, plus `.catch(e => ({error: e}))` as in `updateLfResidualAdvisory` (S:2059). Never throws. Returns `{ok, reason}` with reason in `ok`, `dup` (23505), `timeout`, `error`, `budget`, `no_client_method`.
4. A missing client method (test mocks) is a caught error, not a crash.

### 9.3 Counting failures

No `gf_metadata` write (already read-modify-written at 4 sites, a fifth writer adds a race). Instead a separate row `log_health/system`, upserted only on a failure: `{errors, timeouts, byType:{...}, lastError (200 chars), lastAt}`. Timeouts are counted separately from errors, because a timed-out insert may still land later (PA-20). `dup` is not counted. `budget` skips are counted as `skipped`.

The `log_health` read-modify-write adds two calls on exactly the ticks where the database is failing, so it draws from the `general` pool and is skipped (not retried) when that pool is spent. When skipped, the failure still appears in this tick's `tick_log.aux.logFail` (5.3). If the database itself is down, the `tick_log.at` gap and the `console.error` line in the Netlify log are the record.

### 9.4 Order inside a tick (success path)

1. Everything that exists today, in the same order, through `updateRunHealth`. Validation log writes happen inside step 4 (general pool).
2. Build `summary`, `console.log` it.
3. Send the SUCCESS PING, exactly as today (S:2301). Logging never delays it.
4. Housekeeping: snapshot (hours 3, 4, 5 as in section 7), prune (hour 3 only), each bounded by the `general` pool.
5. Build and write the `tick_log` row (`tick` pool), with `aux` filled from step 4 and from this tick's earlier log failures.
6. Return the same 200 and body as today.

Consequence, stated honestly: if the 30 s function limit is hit during steps 4-5, the ping has already gone and the tick row is lost; the gap in `tick_log.at` shows it. This is the right trade: monitoring correctness over log completeness. Worst added time after the ping is 3 s (general) + 3 s (tick) = 6 s.

### 9.5 Order inside a tick (error path)

The `catch` block sends the `/fail` ping first (unchanged), then writes the error row from the `tick` pool, then returns the same 500 as today.

Logging cannot change behaviour: it runs after the estimation and learning writes it describes; its results are read only by `aux` and `log_health`; the ping and the return value are unchanged. T5b proves the non-log write sequence is identical whether log writes succeed, hang or reject.

## 10. Pruning (L4)

`LOG_RETENTION_DAYS = Object.freeze({tick_log: 180, validation_log: 730, bin_snapshot: 730})`. `log_health` and every other type are never pruned. Runs only on the hour-3 tick, after the snapshot, once per type, inside the `general` pool.

`pruneLogType(client, type)`:
1. `if (!Object.hasOwn(LOG_RETENTION_DAYS, type)) return {error:'type_not_allowed'}` before any query. Callers pass literals.
2. `cutoff = new Date(now - days*86400000).toISOString()`. Refuse if not finite or if `cutoff > now - 30 days` (floor so a bug cannot prune recent rows).
3. Select ids: `.from(TABLE).select('id').eq('observation_type', type).lt('gauge_id', cutoff).order('gauge_id').limit(100)`.
4. If zero ids, stop. Never call delete with an empty list.
5. Delete: `.delete().eq('observation_type', type).in('id', ids)`, with at most 100 ids per call. `id` is a uuid in the live schema (36 chars), so 100 ids is about 4 KB in the URL, safely below gateway limits. The 500-id plan would have put about 19 KB in the DELETE URL and risked 414 errors that would only be counted, so retention would silently never run. One batch of 100 per type per day is enough in steady state (24 ticks a day for `tick_log`); after a gap the backlog drains at 100 a day, which is fine because these are retention trims, not correctness. T7 asserts URL length (see 12).
6. The type predicate stays on the delete, so even a wrong id list cannot remove another type's row.

Why it cannot delete other rows: the allow-list check, the repeated type predicate, the 100-row cap, the 30-day floor, and `deleteObs` (which can delete a whole type) is never called with these names. T7 uses an in-memory mock that EVALUATES filters, so a missing predicate would delete the wrong rows and fail the test.

Ordering check: `gauge_id` is text, DB collation `en_US.UTF-8` (SELECT, 2026-11-10). All three schemes are fixed-width ISO, so punctuation sits at identical positions and text order equals time order even under a locale collation. `validation_log` ids add a `_<uuid>` suffix after the ISO, which only breaks ties.

Indexes: the unique key `(observation_type, gauge_id)` serves the select and the range. No new index.

## 11. Round trips and time cost

Baseline about 17 per tick. Added:
- Normal tick: +1 insert (`tick_log`). About 6%.
- Validation tick: +1 insert per logged fate (usually 1, every 13 to 19 h on a rise).
- Hour-3 tick: +2 reads, +1 insert (snapshot), +3 prune selects, +up to 3 deletes. Hours 4 and 5: +1 existence read each (plus the snapshot if missing).
- Failure: up to +2 calls for `log_health`, only while the general pool has time.

Time: one Supabase insert is typically tens to low hundreds of ms. That is an assumption, not measured; no tick duration is logged anywhere today. The first `ms` values measure it. Hard cap on added time: 3 s general + 3 s tick. With the success ping sent first (9.4), added time cannot make a good run miss its ping. The Netlify 30 s scheduled-function limit is from memory and unverified; the implementer must check it.

## 12. Tests to add (none edit existing tests)

Test seam notes: `getSupabase` is destructured at require time (S:6), so tests patch `shared/model`'s `getSupabase` BEFORE requiring `scheduled-update`. Use `t.mock.timers` instead of real timers. The mock for T7 and T8 is an in-memory store that EVALUATES `eq`, `lt`, `in`, `order`, `limit`, `select`, `delete` filters, so a missing predicate really deletes the wrong rows.

| ID | Test | Catches |
|---|---|---|
| T1 | `makeGFPrediction(args)` deep-equals `makeGFPrediction(args, {})` on every characterization fixture and the C8 fixtures (Date.now frozen), with `usgsData`, `fullHistory`, `correctionBins` deep-frozen; incl. EF missing, no historic PoR, tributary missing | Trace altering, mutating or throwing; estimation drift |
| T2 | Trace content: `stop==='converged'` on steady flow; `max_iter` after the pass cap on a non-converging rising fixture; `no_hist` when history empty; `it` equals passes executed; delta pct/decay/ratio vs hand values; `ceil.lim == lf.q*1.2` and `bound == ceilingApplied`; `fb` flags; EF skip at >50%; `corr.st === prediction.flowState`; `unc` equals `rawFinalUnclipped - correction`; `pre.shifted` false when no historic PoR; `trace` contains only primitives | Wrong source expression; reference leaks |
| T3 | `fetchUSGSData` sets `qTime` (like the `hTime` test, ef-divergence-state.test.js:171); absent when reading invalid. `fetchWaterTemp(out)` sets `out.t` and returns the same value as before | Parser regression; timezone errors |
| T4 | Builders on deep-frozen inputs (`usgsData`, `prediction`, `trace`, `fullHistory`): predicted, ice_skip, null_lf_or_por, error (with partial `tickCtx`); size under 4 KB; all numbers finite or null; `err` truncated, no stack; builders do not throw on frozen input; `final.ts === prediction.timestamp` | Record shape, size, leaks, mutation |
| T5 | `LogBudget`/`writeLogRow`: insert rejects, returns `{error}`, never resolves, or is missing; each returns within its cap; 23505 gives `dup` and is not counted; timeout counted separately from error; `log_health` skipped when the general pool is spent | Logging breaking or slowing the cron; L4 |
| T5a | Budget reservation: validation-log writes that hang (fake timers) exhaust the general pool, then the tick write is STILL attempted and lands | PA-1 |
| T5b | Write-sequence equivalence: record every non-log DB write and its payload during a full handler tick; sequence and payloads are identical when log writes succeed, hang, or reject; the success ping is sent in all three and BEFORE the tick insert; handler return value identical | Logging coupling into the estimate path; ping timing |
| T6 | Handler integration (capturing mock): normal tick yields exactly one `tick_log` insert with `gauge_id` equal to the full-ms start ISO; `slot` is `skipped_in_window` when a live pending row exists; `final.cfs` equals the `gf_history` entry; `final.ts` equals the stored pending `data.timestamp`; ice tick records `ice_skip`; USGS-fetch throw records `out=error`, `why=fetch` stage; `cron-fail-ping.test.js` unchanged and green, `/fail` ping sent before the error row | Exit coverage; ping behaviour; join key |
| T7 | Prune with the filter-evaluating mock: unknown type issues zero queries; select and delete both carry the type `eq`; empty ids issue no delete; cutoff floor refuses a 5-day cutoff; batch cap 100; delete URL length stays under 2 KB with 100 uuids; only runs at hour 3; a synthetic mixed-type store keeps all non-log rows and log rows younger than cutoff; `log_health` and `por_history` untouched. Plus a scan: capture EVERY `delete` issued by `sync-learning.js` actions against the mock and assert each carries an `eq` on a non-log `observation_type`, and `resetGFLearning` leaves all log rows | Deleting something it should not (L4); reset deleting logs |
| T8 | Snapshot: hour 3 writes one row containing EVERY `gf_correction_bin` row in the mock (assert set equality, not a fixed 36) plus the leaderboard; hours 4 and 5 write only if missing; a 23505 re-run is success; other hours write none; read failure is non-fatal | Missing or duplicate snapshots |
| T9 | `validation_log` for every outcome: `validated`, `hard_flagged`, `bin_read_failed`, `stale_deleted`, `bad_due_deleted`, `replaced_missed_window`, `claim_failed`, `claim_lost`: exactly one row each with required fields; `predTs` equals the pending row's `data.timestamp` and equals the corresponding `tick_log.final.ts`; `binBefore` equals the pre-update bin, `binAfter` equals the stored bin or null on write failure; captured stage values equal the stored stage bin; learning results (bins, metadata counters, leaderboard, `gf_validation_history`) identical whether the log insert succeeds, fails or hangs; `storeValidationPair` status is reflected in `pairStored`; existing `validation-failure-logging.test.js` unchanged and green | Log coupling into learning; missing fates; wrong join key |
| T10 | Source scan: `sync-learning.js` contains none of `tick_log`, `validation_log`, `bin_snapshot`, `log_health` | Accidental public exposure |
| T11 | Process gate: final auditor runs the full suite and confirms `git diff` shows no edits under `test/characterization`, golden fixtures, or the three parity tests; checks `storePrediction`/`storeValidationPair` callers and existing tests tolerate a returned status; confirms `COMMIT_REF` appears non-null on the first live row | L7 |

Count and baseline: the suite was 842 tests at v39.0. The implementer records the before and after counts. Neither `npm test` nor `npm run build` was run for this plan.

## 13. Read path (L5) and what is not public

Decision: database only. Open question 2 of the earlier draft is closed: `src/` has no Supabase usage, so the browser does not read this table directly. An auditor reads with SQL (Supabase MCP or a local script). Three example queries (tick window, validation window, snapshot at date) plus the recovery rule go in the Tech Appendix, for example `select gauge_id, data from potomac_observations where observation_type='tick_log' and gauge_id >= '2026-10-10' and gauge_id < '2026-10-20' order by gauge_id`. SQL has no 1,000-row PostgREST cap issue.

Reasons: a GET on `sync-learning` is unauthenticated, rate-limited per instance on a spoofable header (sync-learning.js:13-45), and one call could return 10 MB. It adds cost and scraping surface for a convenience the audit does not need. If wanted later, build it capped (200 rows, 14-day window, cursor on `gauge_id`, cache header).

Nothing in the records is secret: gauge values, model internals, no user data, no keys. Error text is truncated to 200 chars and carries no stack. `commit` is a public git hash. Advisory fields are already public via the `gf` GET.

Tamper caveat (goes in the Tech Appendix): the table's RLS policy "Allow public access" (ALL, role public, true) lets anyone holding the anon key read, delete or forge rows, including these logs. The logs are therefore NOT tamper-evident and must be read as operational evidence, not as a signed record. Fixing RLS is a migration that could break the cron if done wrong; it stays a separate item and is not part of A3.

## 14. Docs and version

Version: MINOR (no estimation change, per Versioning Rules). Choose the number at commit time as the next free minor (v39.2 if still free; the other team's client release may take it). Update all version locations together: `SERVER_VERSION`, `CLAUDE.md` header, CHANGELOG, Tech Appendix, README, `Generated by` footer. `SERVER_VERSION` is maintained by hand and will go stale; the `commit` field in every row is the safety net, and the final audit checks it is non-null on the first live row. A test tying `SERVER_VERSION` to CLAUDE.md was rejected: client-only releases (v39.1) would force server edits.

Bump after the other team's `src/` and docs edits land (same files):
- `CLAUDE.md`: header version; add an "Audit logging (server-only)" bullet under Current Model Parameters: four types, retention, read path, "never feeds the estimate". Also fix two statements that become false: (1) "stored gauge_id values: only `system`, `pending`, and bin keys" becomes "plus tick/validation/snapshot log keys (ISO timestamps)"; (2) "validation-history stamps only live 7 days" gains "(full validation records live 730 days in `validation_log`)".
- `src/assets/CHANGELOG.md`: row, MINOR, estimation unchanged, with "Production behaviour UNVERIFIED until..." per section 16.
- `src/assets/tech-appendix.md`: version history; record schemas; the `outcome` enum; the recovery rule (section 7); the retention table; example queries; the tamper caveat (section 13).
- `README.md`: entry. `Generated by` footer: grep for the current string and update.
- `TODO.md`: add deferred items from section 15.

## 15. Deferred (L6) and rejected

Decisions:
- Scored forecast rows: DEFER. They need the client-posted NWS inputs stored with them; the forecast has no content beyond a time shift of NWS LF (CLAUDE.md). Costs a design of its own. Audit item 4 stays open.
- Monitoring signal for "ran but no prediction": DEFER the ping change. The tick row (`out`, `why`) records it, which is what an audit needs. Sending `/fail` on `null_lf_or_por` or `insert_failed` would page on single-tick USGS blips; ice must stay green in winter. First measure how often those outcomes occur from `tick_log`, then choose a threshold (for example 3 consecutive). The healthchecks.io period and grace are still unconfirmed by the user.
- Shadow-model per-tick outputs, Difficult Run inflow (cron does not fetch it; USGS keeps it), client-side "what the paddler saw" telemetry: out of scope.
- Correcting the off-by-one counters and tightening RLS: separate items.
- Water-temperature reading time is NO LONGER deferred (PA-14); it is in scope.

Alternatives rejected (one line each):
- Add fields to the `makeGFPrediction` return: pollutes pending rows and the parity surface.
- Recompute internals in the handler: duplicate model math can drift.
- New table: needs a migration; the existing table has no type constraint.
- Extend `gf_history` or `gf_validation_history`: single-row read-modify-write, lossy, grows.
- One row per day holding an array: write race, big updates.
- Hourly full bin snapshots: 65 MB/yr, no gain over daily plus validation deltas.
- stdout/Netlify logs only: short retention, not queryable.
- Public GET endpoint now: exposure and cost for no audit need.
- Netlify Blobs or external store: new dependency and secret.
- `gauge_id = Date.now()`: unreadable in queries; ISO is sortable and prunable.
- Counter in `gf_metadata`: fifth writer on a contended row.
- A single wall-clock log deadline: a slow tick would lose its own row (PA-1).

## 16. Unverified gaps (cannot be confirmed before or at deploy)

1. First real prune is at day 180 for `tick_log`. Until then the delete path is proven only by mocks. Mitigation: `aux` logs prune candidate counts daily; after deploy, with the user's approval, insert one synthetic `tick_log` row with `gauge_id = '2020-01-01T00:00:00.000Z'` and confirm the next 03:00Z run deletes exactly that row. That is a database write, so it needs the user's go-ahead.
2. Hour-3 snapshot and prune run only at the next 03:00 UTC; unverified until then. Hours 4 and 5 retry only if hour 3 failed.
3. Real `ms`, row sizes, and total added time are estimates until 24 ticks exist. Check `pg_column_size` and `ms` after a day and a week.
4. Netlify's 30 s scheduled limit (from memory) and the 500 MB vs 2 GB plan limit.
5. `qTime` and water-temperature `latest.dateTime` semantics on live USGS payloads (offset parsing) are tested on fixtures only. Compare `qT` to the USGS page for one tick.
6. Text range order under `en_US.UTF-8` is argued from the fixed-width format, tested by mock, and confirmed live only by gap 1.
7. First `validation_log` row and first `binBefore` appear only at the next validation (13 to 19 h at current flow, longer in calm weather). The non-claimed fates (`stale_deleted`, `replaced_missed_window`, `claim_lost`) may not occur for days or weeks; they are proven by mocks only.
8. Whether PostgREST or RLS settings reject anything: the insert path uses the same service key and table as existing log types (`validation_failure`), so risk is low, but the first row is the proof.
9. `COMMIT_REF` availability inside the Netlify scheduled function runtime is assumed, not verified. If null, the version field alone is the record.
10. With the ping sent first, a tick that hits the function time limit during housekeeping loses its tick row. The gap in `tick_log.at` is the only evidence.
11. No browser tool in this session; nothing here changes the UI, so no browser check is needed.

Verification path (CLAUDE.md global rules): a fresh Opus subagent gets the goal and the diff only, runs the full suite, checks T11, and reads one real `tick_log` row after the first deploy tick. Gaps above are reported as gaps, not passes.

## Audit response

Source: independent plan audit, verdict approve_with_changes, 21 findings. All 21 are ACCEPTED. Where the plan departs from the audit's wording, the departure is stated. Claims were checked against S where noted.

| ID | Decision | Reasoning |
|---|---|---|
| PA-1 | ACCEPTED | Wall deadline would drop the tick row on slow ticks. Section 9.1: cumulative-spent budget, separate 3 s `general` and 3 s `tick` pools. Tests T5a. |
| PA-2 | ACCEPTED | Verified the ping is at S:2301 before return; housekeeping before it would eat ping time. Section 9.4 sends the ping first. Cost: a tick that times out in housekeeping loses its row (gap 10). T5b asserts order. |
| PA-3 | ACCEPTED | Verified stale delete (S:985), bad-due delete (S:1000), claim failure and loss (S:1130-1137) and replacement (S:1777) leave no record today. Section 6.1 gives each an `outcome`; T9 covers all eight. |
| PA-4 | ACCEPTED | `prediction.timestamp` is already in the pending row. Stored as `tick_log.final.ts` and `validation_log.predTs`; T6 and T9 assert equality. |
| PA-5 | ACCEPTED | Added `actualT`, `actualStageT`, the four learning-gate flags, full-object `binAfter` (null on failed write), `binBefore` copied before the in-place mutation, explicit stage capture variable. Section 6.3, T9. |
| PA-6 | ACCEPTED | Recovery rule now takes the newer of snapshot and last `binAfter` with a continuity check; post-update leaderboard stored in `validation_log.lb`. Section 7. |
| PA-7 | ACCEPTED | The write moves to the end of the iteration before `pairs.push`; early-continue paths write their own row. `storeValidationPair` status return added to the file table (section 3, T9, T11). |
| PA-8 | ACCEPTED (modified) | Verified `id` is uuid. Chose the audit's first option: cap of 100 ids per delete (about 4 KB URL) instead of the range-delete, because it keeps the id list explicit and the type predicate. Cost: backlog drains at 100 per type per day, acceptable for retention. T7 checks URL length. |
| PA-9 | ACCEPTED | `trace` holds primitives only; builders never write inputs; T1 and T4 use deep-frozen inputs. Section 4 rules 1 and 6. |
| PA-10 | ACCEPTED | Verified `runStartMs`, `usgsData` are inside `try` (S:2112-2137). `tickStartMs` and `tickCtx` move before `try`; `runStartMs` unchanged. Pre-try config return documented as unloggable (5.2). |
| PA-11 | ACCEPTED | `gauge_id` is the full-ms ISO start; 23505 is `dup`, not a failure. Sections 5.1, 9.2, T5. |
| PA-12 | ACCEPTED | Hours 3, 4, 5 with existence check at 4 and 5; 23505 is success; T8 asserts set equality with the mock's bin rows (28 live, not 36). Section 7. |
| PA-13 | ACCEPTED | Verified `fetchUSGSData` null becomes a throw (S:2124). `why` comes from `tickCtx.stage`. Distinct `rise.rst` and `corr.st`; `stop` replaces `conv`, `it` is passes executed; `pre` with `shifted`; `unc` edit to the S:889 destructure declared; `hist.ts` added. Sections 4 and 5.3, T2. |
| PA-14 | ACCEPTED | Verified `fetchWaterTemp` returns a bare number from `latest` at S:181-198. Added an optional out-parameter that leaves the return value unchanged; `in.tT` logged. Section 3(b), T3. |
| PA-15 | ACCEPTED | Rate wording corrected (about 1.3 to 4 a day); the 24-a-day figure kept only as a labelled conservative bound. Section 8; totals recomputed (about 25 MB realistic, 72 MB bound). |
| PA-16 | ACCEPTED | T7/T8 use a filter-evaluating mock; every `sync-learning` delete is captured and asserted to carry a non-log `eq` (verified deletes exist at sync-learning.js:531, 595-606, 677-682); `getSupabase` patched before require; `t.mock.timers`; T5b write-sequence equivalence; tests for PA-1, PA-3, PA-4 added (T5a, T9, T6). |
| PA-17 | ACCEPTED | `commit` field from `process.env.COMMIT_REF ?? null`; version chosen at commit time as next free minor; all locations updated together. Availability of `COMMIT_REF` in the runtime is an unverified gap (gap 9). |
| PA-18 | ACCEPTED | Section 14 adds the two false CLAUDE.md statements and puts the outcome enum and recovery rule in the Tech Appendix. |
| PA-19 | ACCEPTED | Open question 2 closed: `src/` has no Supabase usage. Tamper caveat added to section 13 and the Tech Appendix. RLS fix stays a separate item because it is a migration that can break the cron. |
| PA-20 | ACCEPTED | Writer returns reason `timeout`; `log_health` counts timeouts separately from errors. Sections 9.2, 9.3, T5. |
| PA-21 | ACCEPTED | `log_health` calls draw from the general pool and are skipped when spent; `tick_log.aux.logFail` lists every failed log write this tick with `predTs`. Sections 5.3, 9.3. |

## Post-review amendments

Source: three independent reviewers (failure modes, neutrality, tests and docs), 17 findings, 6 should_fix and 11 minor. The fix-up was done in two passes; the first was cut off, so the second re-read the code and tests before assigning a status. Every behavioural fix has a test, and each test was shown to fail when its fix is reverted (mutants run in a scratch copy). Suite after the amendments: 1032 tests (1031 pass, 1 opt-in skip, 0 fail), up from 913 at v39.1. The test count quoted in the Count and baseline paragraph above (842 at v39.0) is the plan-time baseline and is left as written.

| ID | Status | What was done |
|---|---|---|
| FM-1 | FIXED (first pass, verified in the second) | `logCtx.inflight` is set when the claim delete succeeds and cleared after the end-of-iteration fate. The handler catch queues a `claimed_then_threw` fate when it is still set. Tests in the validation and handler files. Write-only; learning control flow unchanged. |
| FM-2 | FIXED (first pass) | The prune delete chains `.select('id')`; `deleted` is the number of rows the server returned. Test added. |
| FM-3 | FIXED (first pass) | `aux.logFailTotal` carries the full count; `logFail` stays cut at 10. Doc wording says so. Test added. |
| FM-4 | FIXED (first pass) | A test builds the delete URL with the real PostgrestClient and asserts it is under 8 KB. |
| FM-5 | FIXED (first pass, docs) | Tech Appendix now says the row ends as `replaced_missed_window` or `stale_deleted`, and that the sync-learning replace and the admin reset write no `validation_log` row. |
| FM-6 | FIXED (first pass) | `logMsg` replaces URLs with `<url>` before storing in `logFail`, `lastError` and the tick error. Test added. |
| NEU-1 | FIXED (comment only) | The `logValidationFate` comment now says no log I/O happens before the ping and wall-clock fields are identical up to normal CPU jitter. No code change. |
| TD-1 | FIXED (first pass) | One builder test gives every field a distinct value (qTime differs from hTime per gauge, nonzero correction, ceiling, EF, delta, max_iter, ice). Eight further field mutants, plus the reviewer's ceiling mutant, fail. |
| TD-2 | FIXED (first pass) | The test moves the clock between tick start and prediction, and asserts `final.ts` equals the pending timestamp and differs from `at`. |
| TD-3 | FIXED (first pass) | The stored pending row is asserted to have exactly the pre-A3 key set; the `logV` leak mutant fails. |
| TD-4 | FIXED (first pass) | Handler test: a validated row queued before a later throw is flushed in the catch, before the error tick row. |
| TD-5 | FIXED (first pass) | Handler test: a failed `validation_log` write is counted in `log_health` when the tick write succeeds. |
| TD-6 | FIXED (first pass) | Test seeds an old ISO-keyed `gf_prediction` row; it survives. `gf_prediction` and `validation_failure` are in the refused list. |
| TD-7 | FIXED (first pass) | Rows on each side of 180 and 730 days; only the older row of each pair is deleted. |
| TD-8 | FIXED (second pass) | Hang tests carry a 3 s (handler 5 s) `node:test` timeout, no change to package.json. With the per-call timer removed the suite now ends in about 9 s with exit code 1 (tests timed out or cancelled) instead of hanging. The count of failed tests shows 0 because node reports these as cancelled; the exit code is the signal. |
| TD-9 | FIXED (first pass) | The mock records `limit`; T7 asserts the prune select carries 100. |
| TD-10 | FIXED (first pass, docs) | Tech Appendix 6.10: queued rows can be lost and are then listed in `logFail`; the order sentence names the `log_health` flush; the tick size is stated as measured (about 1.5 KB) against the plan estimate of 2.0 to 2.6 KB (section 5 above is the estimate and is left as written). |

No finding was disputed. None was deferred. Invariants I1 to I3 hold: no protected file changed, no log I/O before the success ping, prune deletes only the three new types.

### Final re-audit residue

The final re-audit passed with gaps. Four small items were closed afterwards. Tests: 1027 to 1032.

| Item | What was done |
|---|---|
| 1. Mutant M3 (validation_log flush moved before the success ping) | New handler test "M3: every log write, validation_log included, comes after the success ping on a validating tick". It runs an hour-3 tick that validates a prediction and asserts every tick_log, validation_log and bin_snapshot insert or upsert (and log_health) is after the ping. In a scratch copy with the flush moved before the ping, only this test fails. |
| 2. Mutant M8 (handler changes a stored prediction value) | New handler test "M8: the stored pending row equals makeGFPrediction on the same inputs, plus only the handler stamps". It rebuilds the inputs (real fetch parsers on the same mock, stored PoR history, bins via `buildCorrectionBins`), calls the real `makeGFPrediction`, and deep-compares every value with the stored row, except the five fields the handler legitimately stamps (`efDivergence`, `divergenceActive`, `lfResidualActive`, `lfResidualLastErrPct`, `shadowModels`), which are checked for presence only. With `predictedCFS += 1` in the handler, only this test fails. No existing test was changed. |
| 3. FM-6 residue | `validation_log.claimErr` (both the `claim_failed` and `claimed_then_threw` paths) and the housekeeping `aux.error` now go through `logMsg`. One test per field (claim_failed in the validation test file, claimed_then_threw in the handler test file, aux.error in the writer test file). With the three changes reverted in the scratch copy, all three tests fail. The mock gained an optional `faults.claimMsg`. |
| 4. Doc wording | (a) CLAUDE.md now says `tick_log` and `bin_snapshot` use an ISO timestamp and `validation_log` uses `<valAt ISO>_<pending row id>`. (b) "one row per terminal fate" is now "one row per logged fate" in CLAUDE.md, README, CHANGELOG, the Tech Appendix and this plan; `claim_failed` is stated as not terminal (the pending row stays and can be logged again on a later tick). (c) The Tech Appendix says `logFail` is cut at 10 entries and `logFailTotal` caps at 50 because the budget keeps at most 50 failure entries. (d) The size table says the `tick_log` size is measured in tests with mock data and that no size is measured in production yet. |

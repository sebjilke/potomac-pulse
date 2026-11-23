# FIDELITY_SPEC: what the replay must reproduce, and what counts as a miss

Written before the gate was run for the first time (PLAN 4.4, audit N4). Nothing below was tuned against replay output.
Every later change to this file is dated at the bottom and has a matching entry in `GATE_ITERATIONS.md`.

## 1. What is replayed

All 305 rows of the job log in time order. Error rows (`out = error`, all `usgs_fetch_failed`) add nothing to the stored
Point of Rocks history (a failed fetch throws before the store, `scheduled-update.js` handler step 1) and are not replayed.
Every one of the 280 `predicted` rows is replayed, whether or not `used = 1`, because every successful run adds to the stored history.

Per run, the code of the version that ran it is imported unchanged (`code/v39.2` for rows 1 to 2, `v39.6` for rows 3 to 191,
`v39.11` for rows 192 to 305, by the logged `ver`). Only three things are stubbed: `fetch` (serves frozen readings), the
Supabase client (an in-memory store for the `por_history` row, read and written by the real `storePoRHistory`/`getObs`/`upsertObs`)
and `Date.now` (frozen at the run's logged `final.ts`). Steps replayed with the production functions: `fetchUSGSData` and
`fetchWaterTemp` (including the adapter path from the 17:01 UTC run of 17 Nov, `src = new`), `storePoRHistory`, the history
read-back, `makeGFPrediction` with the run's own `trace`.

Inputs come only from frozen USGS values at the logged reading times: `in.*.qT`, `hT`, `tT`. Logged VALUES are never fed in.
Point of Rocks flow: old archive to 9 Nov 23:55 UTC; `f_old` (rule A; identical to rule B inside the knot range, and every
10 Nov to 13 Nov 17:55 stamp is inside it) from 10 Nov 00:00 to 13 Nov 17:55 for runs before the revised fetch; the current
record for readings first fetched by a run at or after the revision (the first such run is read from the log, not assumed:
the first run whose logged `in.por.q` equals the current record at its `qT`). All other gauges and Point of Rocks level and
temperature: the current record. A run's fetch window for each series is `(at - 48 h, logged reading time]` (period P2D).
Stored history before the first logged run: the frozen readings in `(clock_1 - 72 h, qT_1]` with the same value rule
(the job ran hourly before the log began, so its store already held them).

## 2. Bin state at each run (the correction a run applied)

The prediction at run k uses the bins as loaded after run k's own validation step (handler step 4 before step 5). Timeline:
the first daily snapshot (11 Nov 03:00 UTC) is the state of every run before it (no check was due before 11 Nov 10:00); from
each snapshot onward the state is the newest of (a) the latest snapshot at or before the run's start, (b) for the bin a check
updated, the full-precision `binAfter` of the latest check whose `tickAt` is at or before the run's start. Fields used by the
production correction code: `count`, `emaMeanError`, `meanError` (plus sums for completeness). Snapshot values are rounded to
3 decimals; check values are full precision.

## 3. Fields compared, tolerance, and which count toward the gate

"Logged rounding" is the rounding `buildTickRecord` applies (`logNum(x, d)`); the replayed value is rounded the same way and
compared for equality unless stated otherwise.

| field | logged rounding | pass rule |
|---|---|---|
| `hist.ts` | epoch ms | equal |
| `hist.cfs` | 1 dp | equal (Gate B: also reported as difference in cfs) |
| `hist.ago` | 2 dp | equal |
| `rise.r` | 3 dp | equal |
| `rise.rst` | text | equal |
| `trv.t0`, `trv.t` | 2 dp | equal |
| `trv.it`, `trv.stop` | integer, text | equal |
| `trv.mult` | 3 dp | equal |
| `trv.gf2lf` | 2 dp | equal |
| `delta.pct` | 2 dp | equal |
| `delta.ratio` | 4 dp | equal; both blank = equal |
| `pre.cfs` | 1 dp | equal |
| `raw.cfs` | 1 dp | equal |
| `corr.st`, `corr.bin` | text | equal |
| `corr.c` | 1 dp | equal, or unrounded replay within 0.05 + 0.001 of the logged value (the 0.001 is the 3-decimal precision of snapshot-derived bin values) |
| `ceil.lim` | 1 dp | equal |
| `ceil.bound` | 0/1 | equal |
| `final.cfs` | integer | equal, or unrounded replay within 0.5 + 0.001 of the logged value (same reason) |
| `due` | ms | within 5 s of the logged value; exact-millisecond equality is also tabulated |
| `in.porHist.n`, `firstT`, `lastT` | integer / epoch ms | equal |
| current readings: PoR q, LF q, Monocacy, Goose, Broad Run, Seneca flows, Edwards Ferry stage, PoR stage, LF stage, temperature | as logged | frozen value at the logged reading time equals the logged value; and the logged reading time exists in the frozen record |

Informational (tabulated, not counted toward pass or miss): `por.est`, `pre.shifted`, `trv.nohist`, `delta.decay`, `raw.stage`,
`corr.unc`, `final.stage`, `ef.est`, `ef.w`, `ef.used`, `ef.disc`. `final.ts` is the frozen clock and is not compared.

A run MISSES if at least one counted field fails. Counting is per run, not per field.

## 4. Gate A and Gate B membership

Each run gets three component labels from the provenance of the stored values it used: the current reading, the reading 6 hours
back (the entry `getPoRRiseRateFromHistory` and `getFlowState` pick: the latest stored entry at or before `final.ts - 6 h`), and
the time-shifted reading (`hist`). A value has provenance `archive` (stamp up to 9 Nov 23:55 UTC), `f_old` (stamp 10 Nov 00:00 to
13 Nov 17:55 and first seen by a run before the revision) or `current` (anything else). A run is in Gate B if any of the three
used values has provenance `f_old`; otherwise in Gate A. (Old = `archive` or `f_old`; new = `current`.)

For Gate B runs the current-reading comparison of an old run is circular (the curve was fitted on that pair), so for the
fields "PoR q" it is tabulated but is not a basis of any pass statement.

## 5. Gate A

At most 3 Gate A runs may miss. Each miss must fall in a category listed here, assigned by the rule written here, in this order:
1. `value_rewritten_after_run`: a logged current-reading value differs from the frozen record at its logged reading time (USGS changed that value after the run saw it), or the frozen `last_modified` of that reading is later than the run's start.
2. `reading_not_yet_published`: the replayed stored history differs from the logged `in.porHist` (`n`, `firstT` or `lastT`) and at least one reading stamp inside that run's fetch window has a frozen `last_modified` later than the run's start (the job cannot have had it).
3. `duplicate_run_row`: the run is not the `used` row of its clock hour (`rows_in_hour > 1`, `used = 0`) or a sibling run within 15 minutes executed concurrently.
Any miss not assignable to one of the three, or more than 3 misses, ends the build: write up the fidelity table and report; no tolerance is loosened, no run is special-cased, no logged value is injected.

## 6. Gate B

Gate B runs (any `f_old` value used): (i) every `hist.cfs` within 20 cfs (one step) of the logged value; (ii) at least 95% of Gate B runs with `hist.cfs` exactly equal; (iii) the 6-hour reading is checked through `rise.r`: at least 95% of Gate B runs with `rise.r` equal at 3 decimals, and each mismatch is reported with the implied cfs difference of the 6-hour reading. If Gate B fails, the S0 replay of those runs is labelled `approximate` and the replay continues; it is not a stop.

## 7. Outputs

`out/fidelity_table.csv` (one row per run and counted or informational field: logged, replayed, difference, pass), `out/fidelity_summary.csv`
(per field: runs compared, passes, rate; per gate: runs, misses, categories), `GATE_ITERATIONS.md` (one entry per attempt).

## Dated changes to this spec

- 2026-11-22, after attempt 1 (see `GATE_ITERATIONS.md`, attempt 2): section 1, the run's fetch window. A reading of the current
  record whose frozen `last_modified` is later than the run's start AND later than the 13 Nov bulk-revision stamp
  (2026-11-13T19:41:13.495341Z) is not part of that run's fetch, except the reading at the run's logged reading time. Applied to
  every run and every scenario. No tolerance, no field list, no gate limit and no category was changed.
- 2026-11-22, after attempt 2: bin timeline, section 2: a snapshot's effective time is its row's `created_at` (the end of the run
  that wrote it), not its 03:00 key (on 17 Nov the 03:00 run failed and the 04:00 run wrote that day's snapshot). Gate numbers unchanged.
- 2026-11-23 (audit finding 4; checked in `lib/engine.cjs`, `seriesForRun`): two edges of the availability rule. (a) The exception covers only the reading at the run's logged reading time (`s.t[i] !== T`). An older stamp that the job held, and that USGS rewrote after the run, would be excluded wrongly (its `last_modified` is later than the run start). No such case occurs: the replayed history count equals the logged count on every new-world run (272 of 280 runs equal; the eight differences are old-service runs, seq 8 to 64). (b) The condition "later than the 13 Nov bulk stamp" is what keeps every reading that carries the bulk stamp (all readings up to 13 Nov about 19:35 and everything older) in the fetch of every scenario; without it the whole old-world history would be excluded in S-new and in the S-old scenarios, and the old-world stamps of S0 as well. For readings published after the bulk stamp, `last_modified` is the publication time (audit: it equals the job's own logged `pub` stamp on 113 of 114 new-service runs).
- 2026-11-23: the revision boundary is now derived from the bulk stamp (first run that started after 2026-11-13T19:41:13.495Z; seq 72) and asserted equal to the run found by comparing the logged current flow with the record; both give seq 72. No gate number changed.

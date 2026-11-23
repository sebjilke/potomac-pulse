# replay: the Potomac Pulse prediction replay for 10 to 22 November 2026

Re-runs the production prediction code (frozen exports of three commits) on every hourly run of the job log, first as it ran (S0)
and then under counterfactual Point of Rocks numbers (S-old-A, S-old-B, S-new), with a 2 x 2 x 2 on the raw estimate and a truth
series. Built for the study in `../PLAN.md` (sections 4.3 to 4.5, 5). It analyses nothing.

## One command

```
./run_all.sh                          # from this folder; needs Node 24 and Python 3 only, no network, no database
./run_all.sh --gate-ruling="<text>"   # only after a ruling on a Gate A that is not PASS
```
It runs, in order: `python3 -I verify_copy.py` (the separate post-iteration copy equals production lines 999 to 1082, all three versions have the same body),
`python3 -I f_old/build_f_old.py` (old curve), `node replay.cjs` (gate, then scenarios, labels, 2 x 2 x 2, truth).
Outputs are in `out/` (see `out/OUT_DICTIONARY.md`). Reruns are byte-identical (checked by running twice and comparing MD5 of every file).
Without `--gate-ruling`, `replay.cjs` writes the fidelity outputs and stops if Gate A is not PASS. `--outdir=DIR` writes elsewhere.

## Folder
| path | what |
|---|---|
| `code/v39.2`, `v39.6`, `v39.11` | `netlify/functions` of commits f760635, 20ed8d8, cd7b0c3 (`git archive`, read only) |
| `R8A_CODE_DIFF.md` | prediction path across the three versions, function by function |
| `f_old/` | old curve: `CURVE_DEFINITION.md` (written before the test), `build_f_old.py`, `pairs_fit.csv`, `pairs_test.csv`, `lookup_by_day.csv`, `f_old_values.csv`, `F_OLD_REPORT.md`, `f_old_summary.json` |
| `FIDELITY_SPEC.md`, `GATE_ITERATIONS.md` | what the gate compares and tolerates (written before the first gate run); one entry per attempt |
| `lib/loader.cjs` | loads a version's code with `@supabase/supabase-js` stubbed; one line is appended in memory to export `storePoRHistory` (the file on disk is unchanged) |
| `lib/engine.cjs` | frozen readings, fake USGS responses (old structure before the switch, new-service FeatureCollection through the adapter from the 17:01 run of 17 Nov), in-memory store for the `por_history` row, bin timeline, one replayed run |
| `lib/gate.cjs`, `gate_run.cjs` | fidelity comparison and gate verdict |
| `lib/post_iteration_copy.cjs`, `verify_copy.py` | the only copied production arithmetic (for the 2 x 2 x 2), with a mechanical line-by-line check |
| `replay.cjs`, `run_all.sh` | orchestration |
| `compare_before_after.py`, `baseline_before_fix_round.json` | fix round 2026-11-23: proof that rows of the earlier scenarios and rules did not change |
| `LOG.md` | counts, anomalies, what was not done |

## What is stubbed (and nothing else)
`fetch` (serves frozen readings at the logged reading times), the Supabase client library and client (an in-memory `por_history` row read and
written by the real `storePoRHistory`/`getObs`/`upsertObs`), `Date.now` (frozen at each run's logged `final.ts`). The environment variable
`USGS_API_KEY` is set to a dummy string for runs with `src = new` so that the job's own source selection takes the new-service path.
Logged values are never inputs: the log supplies run times, reading times, version and source, and (to find the revision boundary) the
comparison of the logged current flow with the current record.

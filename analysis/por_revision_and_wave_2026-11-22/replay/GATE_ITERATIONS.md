# GATE_ITERATIONS: one entry per attempt at the fidelity gate

Rule: a change is allowed only with a reason from the code or from the data's own provenance fields; "it makes the numbers
match" is not a reason. Tolerances in `FIDELITY_SPEC.md` are not changed.

## Attempt 1 (spec as written; engine as first built)

Setup: all 280 predicted runs replayed (scenario S0), history rebuilt with the first-seen rule from the stamps of the frozen
record at or before each run's logged reading time (window `(at - 48 h, qT]`), bins from the snapshot/check timeline,
clock frozen at `final.ts`, `f_old` rule A for 10 Nov 00:00 to 13 Nov 17:55 stamps of runs before the revision. Revision run read
from the log: run index 71 (seq 72, 13 Nov 20:00:56), the first run whose logged flow equals the current record.

Result: Gate A 174 runs, **16 misses**; Gate B 106 runs.
- Gate A misses: 14 on `in.porHist.n` only or with `cur.temp.c` (replayed history has more stamps than the logged one: logged 852, replayed 853 to 862; `firstT` and `lastT` equal), seq 112, 120, 128, 136, 145, 147, 163, 252, 260, 268, 276, 284, 292, 300; 2 runs with a logged current Point of Rocks value that differs from today's record (seq 212: logged 1840 cfs at 1.13 ft, today 1860 cfs at 1.14 ft, for the 12:00 reading; seq 217: `rise.r` only, 6-hour-back entry is that same 12:00 stamp stored first-seen).
- Every other counted field passed on every Gate A run except those listed. Per field over 280 runs: `hist.*`, `trv.*`, `delta.*`, `pre.cfs`, `raw.cfs`, `due`: 279 of 280 (all misses are seq 212); `rise.r` 278 (212, 217); `corr.*`, `ceil.*`, `final.cfs`, `rise.rst`, `trv.stop/it/mult` etc. 280 of 280; `in.porHist.n` 253 of 280; `cur.temp.c` 277 of 280.
- Gate B: `hist.cfs` exact in 106 of 106 (maximum absolute difference 0 cfs), `rise.r` exact in 106 of 106. The 13 Gate B runs that "miss" miss only on `in.porHist.n` (seq 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96, 104; logged 852, replayed 857 to 860); seq 56 also on `cur.temp.c`.

What was examined: the `in.porHist.n` pattern. The mismatching runs are the 04:00, 12:00 and 20:00 UTC runs (period 8 h). Replayed `n` equals the number of readings in the window if every stamp were present; the logged `n` is smaller by the number of stamps backfilled shortly after the run.

## Attempt 2 (change: availability of readings at run time)

Change: a Point of Rocks reading of the CURRENT record is part of a run's fetch only if its frozen `last_modified` is not later than the run's start (except the reading at the run's logged reading time `qT`, which the log shows was present), and only where `last_modified` is a publication stamp, i.e. later than the common stamp of the 13 Nov bulk revision (2026-11-13T19:41:13.495341Z, carried by every revised reading up to 13 Nov 19:35 and by all older readings). Readings under the old-archive and `f_old` rules have no publication stamp and stay present. The rule is applied identically to every run and every scenario.

Reason: not from the replay output but from the data and the code. `storePoRHistory` stores exactly the stamps that the fetch returned, and a USGS value cannot have been returned before it was written; USGS's own `last_modified` is the write time. Attempt 1 assumed that every stamp up to the newest reading existed at run time, which is an error of the reconstruction (the plan's category "a reading not yet published at run time"). Direct evidence in the frozen record, looked at before the change: for the failing runs the stamps in the gap carry `last_modified` about 2 minutes after the run's start (seq 136: ten stamps 11:00 to 11:45, `last_modified` 12:02:27, run start 12:00:54, logged reading 11:50), and their number equals the replayed minus the logged count. The rule does not look at any logged value; it does not touch the old-world runs (Gate B), whose readings carry only the bulk stamp.

Expected, written before running: this removes the `in.porHist.n` misses of Gate A (new-world runs); it should not change any run that passed (if it does, the reasoning is wrong).

Result of attempt 2: the change did what it was written to do and nothing else. 119 stamps were excluded as not yet published (counter `late_stamps_excluded`, all runs and scenario S0). `in.porHist.n` now equal on 272 of 280 runs (was 253): every new-world miss is gone, no previously passing run broke, and the five Gate B runs of 13 Nov 20:00 to 15 Nov 04:00 (seq 72 to 104), whose newly fetched stamps are revised readings with a publication stamp, were fixed as well.

- **Gate A: 174 runs, 4 misses (cap 3). Gate A FAILS by one run.** The four, each in pre-listed category `value_rewritten_after_run`:
  - seq 136 (16 Nov 12:00:54): logged water temperature 8.4, frozen record 8.3 (only difference);
  - seq 147 (16 Nov 20:01:21, a duplicate-run row of its hour): logged 10.3, frozen 10.4 (only difference);
  - seq 212 (18 Nov 13:00:59): the Point of Rocks 12:00 reading was logged as 1840 cfs at 1.13 ft; the frozen record has 1860 cfs at 1.14 ft (`last_modified` 13:03:30, 2.5 minutes after the run began); everything downstream differs;
  - seq 217 (18 Nov 18:01): `rise.r` only; its 6-hour-back entry is that same 12:00 stamp, which the job stored first-seen as 1840 and the replay holds as 1860 (the rewritten value).
- Gate B: 106 runs. `hist.cfs` exact in 106 of 106, maximum absolute difference 0 cfs; `rise.r` exact in 106 of 106. Gate B passes on the criteria of FIDELITY_SPEC section 6. Eight Gate B runs miss on `in.porHist.n` only (seq 8, 16, 24, 32, 40, 48, 56, 64; logged 852, replayed 857 to 859; seq 56 also `cur.temp.c`): old-world stamps carry no publication stamp, so the availability rule cannot apply to them.

Decision: attempt 3 is not made. The remaining differences are values USGS wrote after the run (nothing in the frozen record holds what the job saw), and the remedies would be to inject logged values (seq 212, 217), to special-case runs, or to relax the cap or the field list after seeing the result. All three are forbidden. Per the brief the study stops here for a ruling. The fidelity table and summary are written; no scenario output is delivered.

Information for the ruling (facts, no recommendation): the two temperature differences are 0.1 degC, change no counted chain value, and the temperature enters the model only through the cold/default Edwards Ferry coefficient (8.4 and 10.3 degC lie on the same side of the 10 degC switch as 8.3 and 10.4; Edwards Ferry weight is about 0.0001 at these flows). Without them the count is 2 (seq 212, 217).

## Engine changes after attempt 2 (gate numbers re-checked: unchanged, Gate A 4 misses of 174 runs, Gate B 106 runs)

1. Availability rule applied to every scenario (not only to current-valued stamps): publication timing belongs to USGS's service, so the S-old and S-new histories must lose the same late stamps as S0 (reason: "everything else identical in all scenarios"). S0 is unaffected.
2. A snapshot's effective time is its `created_at` (see FIDELITY_SPEC dated changes). Reason: the bin-timeline check against the 11 daily snapshots showed a mismatch of up to 69 cfs on 13 and 17 Nov that came from the key time, not from the bins; with `created_at` the largest EMA difference to the 11 snapshots is 0.0005 cfs (rounding) and the largest count difference is 0.
3. Truth series: the validating runs are filtered by the frozen LF value at the logged reading time (was the logged value; no result changed).

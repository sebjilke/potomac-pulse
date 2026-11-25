TOOL FIT FOR USE

# Tool audit: `tools/replay_onset.mjs` (onset study, 2026-11-25)

Auditor: independent, did not build the tool. Node v24.12.0, Python 3 (`python3 -I`, standard library only).
Everything below was run by me. My scripts and outputs are in the scratch folder
`/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/onset_tool_audit/`
(`p3.mjs`, `p4_p6_p8.py`, `strip.py`, `mut/`). No file outside that folder was changed except this report.
I computed no error of any estimate and no comparison between correction rules.

## Findings

No BLOCKER. No MAJOR. Five MINOR points.

1. **MINOR. Three added columns are not covered by any row check.** `span_h`, `ageR_h` and `ageS_h` are not
   checked by (a), (b) or (c). `lfCap` is checked only through (c), and (c) only sees it on rows where the
   cap binds (5,226 of 129,534 rows in arm L, 5,406 of 129,549 in arm F). Evidence: in my scratch copy I
   broke `span_h` (measured from the sim hour instead of the newest reading), `ageR_h` (read from the
   falling cell) and the age bookkeeping (counting hard-skipped validations as learns). All three runs
   passed every check and exited 0. This matters because a rule that lowers the correction can make the
   cap bind on rows where it did not bind in production, so a wrong `lfCap` on non-binding rows would
   reach the study unseen. The shipped values are right: my independent routes (points 3 and 4) match
   `lfCap`, `span_h`, `ageR_h` and `ageS_h` on every row of both arms.
   Recommendation: keep this audit's independent recomputation as the evidence for these columns; the
   specification should say that `lfCap` was verified against the input on every row, not only by (c).
   No change to the tool is needed for this run.

2. **MINOR. The counts files name the wrong tool.** Line 2 of `counts_L.txt` and `counts_F.txt` reads
   `command: node ci_backtest_harness_lag.mjs ...` (fixed text inherited from the original), although the
   run was `replay_onset.mjs`. Provenance only. Recommendation: say so in the README, or fix the text in a
   later version.

3. **MINOR. The copy's default input path is broken.** The default `--in` is `__dirname/../hourly_backtest_data_v361.csv`.
   The copy lives one folder deeper than the original, so this now points at
   `analysis/onset_correction_2026-11-25/hourly_backtest_data_v361.csv`, which does not exist; a run without
   `--in` stops with ENOENT (shown on my scratch copy). Harmless: the plan requires `--in`, and the error is
   loud. To run the older input one must pass `--in=analysis/hourly_backtest_data_v361.csv`.
   Recommendation: note it in the README.

4. **MINOR, for the specification. Some rising hours have a state span far from 4 or 5 hours.**
   `span_h` is the gap between the newest PoR reading and the past reading. After gaps in the PoR record it
   is 0 to 3 h or 6 to 53 h. Among predicted rising hours below 25,000 cfs: arm L has 16,062 at 4 h, 10 at
   3 h, 24 at 5 h, 41 at 6 h, 8 at 7 to 9 h and 8 at 49 to 52 h; arm F has 18,430 at 5 h and 251 elsewhere
   (8 to 10 h: 53; 49 to 53 h: 10). On those hours `d6` is a change over that span, not over 4 or 5 hours,
   so `r` means something else. This is how production behaves on that history, so it is not a tool
   defect. Recommendation: the specification should state whether these hours stay in R (the plan does not
   exclude them) and report their count.

5. **MINOR, for the specification. `ageR_h`/`ageS_h` are ages of the own flow range's cells only.**
   Inside the smoothing bands around 3,000, 6,000 and 12,000 cfs, `corrR` and `corrS` are blends of two flow
   ranges, and a cell with fewer than 5 observations falls back to other cells. The age columns do not
   describe those mixed values. A learn at the same hour gives 0; hard-skipped validations do not count.
   The README says this correctly. Recommendation: the A1 table by `ageR_h` should say so in a footnote.

## 1. The copy changes nothing but adds columns

Read: the whole diff. I regenerated it (`diff original copy`) and it equals `tools/replay_onset.diff` byte for
byte. Added lines: two require paths (one level deeper), two imports (`getGFCorrectionInterpolated`,
`CEILING_RATIO`), 14 names appended to `SHADOW_COLS`, a `lastLearn` map and a counter object, one call
`onsetColumns(...)` placed after every field of the row and the `dueMs` are set and before the return,
the functions `onsetFail` and `onsetColumns`, one `lastLearn.set(cellKey, T)` after `updateCorrectionBin`,
one extra return field and two console lines. `onsetColumns` only reads `trace`, `pred`, `inp`, `hist`,
`bins` and `S`; `getGFCorrectionInterpolated`, `getGFCorrection`, `getFallbackCorrection` and
`getBinCorrection` in `shared/model.js` are read-only on the cells. Nothing added changes the model call,
what is learned, when, or the row order. The only effect on control flow is a throw when a check fails.

Ran (v39 input, `--gate=new --mode=hybrid`), all exit 0:

| Comparison | Result |
|---|---|
| L: copy shadow with last 14 columns cut (my own Python cutter) vs fresh original | identical, SHA-256 549f2006... |
| L: same vs `forecast_from_measured_water_2026-11-24/replay_B/shadow_L.csv` | identical |
| L: learn and bins, copy vs fresh original vs replay_B | identical (be9c95c1..., ad2a48e1...) |
| F: copy shadow cut vs fresh original | identical, 0cde90f7... |
| F: learn and bins vs fresh original | identical (eec61197..., cca914dd...) |
| F, older input `analysis/hourly_backtest_data_v361.csv`: copy cut vs fresh original vs on-disk `replay_lag_2026-11-17/shadow_F.csv` | all three identical, 1de92d2e... |
| F, older input: learn and bins, copy vs fresh original vs on-disk | identical (f334a307..., d359b7cc...) |
| My fresh copy runs vs files in `replay_L/` and `replay_F/` | shadow, learn, bins, stdout byte-identical (dcc63931..., 7fb80722...) |
| counts files | identical except line 2 (`command:` echoes the output folder) |

## 2. Each added column

| Column | Code | Verdict |
|---|---|---|
| `rawUnc` | `trace.rawUnc` = `rawFinalUnclipped` (post-ensemble, pre-correction, pre-cap) | right. `floor(rawUnc+0.5)` = `rawFinalCFS` and `getFlowBin(rawUnc)` = `flowBin` on every row, both arms |
| `corrUsed` | `trace.corr` = the `correction` returned by `applyGFCorrection` | right |
| `corrR/S/F` | `getGFCorrectionInterpolated(bins, trace.rawUnc, state)` on the same live cells object, called after the model and before any later learning | right (point 3) |
| `d6`, `p6Ts`, `p6Cfs` | same scan as `getFlowState` (needs 8 entries, last entry at or before t-6h), current = `inp.por.v` = `por.q`, clock = sim hour = the patched `Date.now()` | right (point 4). `p6Ts` is ISO UTC with milliseconds |
| `thr6` | `max(100, 0.02 x current)` | right; it is also filled when `histShort` = 1 |
| `span_h` | newest history entry minus past reading, hours | right (point 4); see finding 4 |
| `histShort` | 1 when fewer than 8 entries or no reading at or before t-6h | right; then `d6`, `p6Ts`, `p6Cfs`, `span_h` blank |
| `lfCap` | `inp.lf.v`, the same value passed as `lf.q` | right; equals `lfQ` and the input LF at t-1 on every row |
| `ageR_h`, `ageS_h` | sim hours since the last `updateCorrectionBin` on `<flowBin>_rising/steady`; blank if never | right (point 3); see finding 5 |

Blanks: all 14 columns are blank on exactly the `no_por` and `no_lf` rows (L 1,453, F 1,438) and filled on
every `predicted` and `no_truth` row. Precision: numbers are written with JavaScript `String(number)`, the
shortest text that reads back to the same double. No value in the added columns uses exponent notation or
NaN/Infinity (checked in arm L). Exact equality (`==`, no tolerance) of my recomputed doubles with the
parsed text, in Node and in Python, shows the round trip is exact.

## 3. Independent path to the three corrections

Route: `p3.mjs` rebuilds the 18 cells from `bins_<arm>.csv` alone (one row per cell update: `count`,
`emaMeanError`), applies every update with `ts` at or before the predicted hour (learning comes before
prediction in an hour), and calls the production `getGFCorrectionInterpolated` itself. The file is
sufficient: `getGFCorrection` and its fallback read only `count` and `emaMeanError` (`meanError` is read
only when `emaMeanError` is undefined, which in the replay means count 0). I compared every row with a
prediction, not a sample, with `===` against the parsed text.

| Arm | Rows compared | of which near 3k / 6k / 12k / 25k (±12%) | own cell sparse (<5 obs in any state) | before 2012-12-01 | Mismatches in corrR, corrS, corrF |
|---|---|---|---|---|---|
| L | 129,534 | 11,170 / 11,427 / 10,948 / 4,171 | 3,109 | 8,751 | 0 |
| F | 129,549 | 11,136 / 11,434 / 10,989 / 4,187 | 2,324 | 8,753 | 0 |

All six flow ranges and all three states are covered (L: rising 19,511, steady 77,503, falling 32,520).
All 23,651 (L) and 23,662 (F) bin rows were consumed. `ageR_h` and `ageS_h` recomputed from the same file:
0 mismatches in both arms.

## 4. Independent path to the state inputs

Route: `p4_p6_p8.py`, from the input CSV and the arm rules of the original tool's README only (arm L PoR
from t-2h, arm F from t-1h, LF from t-1h; last value at or before the lagged time within 48 h; history =
PoR rows from t-72h up to the arm's PoR row; past = last history entry at or before t-6h when the history
has 8 or more entries). Every row with a prediction, both arms. Compared exactly: `d6`, `thr6`, `p6Ts`,
`p6Cfs`, `span_h`, `histShort`, `lfCap`, `porQ`, and the state rebuilt from my own values against
`flowState`. Result: 0 mismatches (L 129,534 rows, F 129,549 rows).

`span_h` per arm, rows with a prediction (status `predicted` in brackets):

| span_h | L | F |
|---|---|---|
| histShort | 571 (571) | 570 (570) |
| 0 | 883 (759) | 767 (684) |
| 1 to 3 | 154 (151) | 77 (74) |
| 4 | 127,338 (126,688) | 645 (628) |
| 5 | 79 (79) | 126,543 (125,915) |
| 6 | 439 (279) | 691 (492) |
| 7 to 12 | 42 (40) | 222 (214) |
| 18 to 29 | 8 (8) | 10 (10) |
| 49 to 53 | 20 (20) | 25 (25) |

## 5. Do the row checks bite?

Read: (a) rebuilds the state from the tool's own scan and compares with the model's state, then repeats
the past-reading lookup by binary search over the whole PoR series; (b) compares the logged correction of
the model's state with `corrUsed` by `!==`; (c) recomputes the shown value with `Math.floor(... + 0.5)` and
the imported `CEILING_RATIO`.

My own faults, each in a scratch copy, arm L, full run (the unbroken scratch copy reproduces the shadow
hash dcc63931... and exits 0):

| Fault | Result |
|---|---|
| corrR/S/F looked up off the rounded `rawFinalCFS` | stopped, exit 1, (b) at 2011-12-19T23:00 |
| corrR and corrF swapped | stopped, (b) at 2011-12-01T19:00 |
| `lfCap` from the LF row at t (lag 0) | stopped, (c) at 2011-12-08T11:00 |
| current PoR taken at t-1h instead of the arm's value | stopped, (a) state at 2011-12-03T23:00 |
| past reading strictly before t-6h | stopped, (a) past reading at 2011-12-01T14:00 |
| `corrUsed` rounded | stopped, (b) at 2011-12-01T10:00 |
| threshold 3% instead of 2% | stopped, (a) state at 2011-12-02T11:00 |
| `rawUnc` + 0.4 | stopped, (c) at 2011-12-01T07:00 |
| `span_h` from the sim hour | NOT caught, exit 0 (finding 1) |
| `ageR_h` from the falling cell | NOT caught, exit 0 (finding 1) |
| hard-skipped validations counted as learns | NOT caught, exit 0 (finding 1) |

## 6. Check (c) from the file alone

`floor(min(rawUnc - corrUsed, 1.2 x lfCap) + 0.5)` = `predictedCFS` when `lfCap` > 0, else without the cap,
parsed from the CSV text. `lfCap` > 0 on every filled row.

| Arm | Language | Rows | Mismatches | Cap binds |
|---|---|---|---|---|
| L | Node | 129,534 | 0 | |
| L | Python | 129,534 | 0 | 5,226 |
| F | Node | 129,549 | 0 | |
| F | Python | 129,549 | 0 | 5,406 |

Also from the text, both languages: the logged correction of the model's state equals `corrUsed` on every row.

## 7. Deviations from the plan

- Arm F regression on the older input (plan section 5). The builder's same-input comparison is the
  stronger test that the copy adds only columns, but it does not tie the run to a frozen artifact. I ran
  the older-input comparison: copy (cut) = fresh original = on-disk `replay_lag_2026-11-17/shadow_F.csv`,
  and learn and bins identical. The plan's requirement is now met.
- The plan's regression asks for arm L against replay_B "byte for byte"; met.
- Findings 2 and 3 (counts text, default path).
- `thr6` is filled on `histShort` rows; the plan does not say. Harmless: those rows are steady.
- The plan says "a marker when the rule had too little history"; `histShort` also marks "no reading at or
  before t-6h". The README says so.
- No other departure found. Row count of the input 130,416 and its SHA-256 match the README.

## 8. Row accounting

| | L | F |
|---|---|---|
| shadow rows | 130,987 | 130,987 |
| predicted | 128,595 | 128,613 |
| no_truth | 939 | 936 |
| no_por | 1,014 | 999 |
| no_lf | 439 | 439 |
| other | 0 | 0 |
| rows with added columns (predicted + no_truth) | 129,534 | 129,549 |
| blank among those: d6, p6Ts, p6Cfs, span_h | 571 | 570 |
| blank among those: ageR_h / ageS_h | 535 / 63 | 537 / 65 |
| blank among those: other added columns | 0 | 0 |
| predicted rows rising / steady / falling | 19,399 / 76,807 / 32,389 | 22,105 / 66,799 / 39,709 |
| predicted rising rows with flowBin below 25,000 | 16,153 | 18,681 |
| of those, d6 / thr6 exactly 1 | 478 | 560 |
| of those, ageR_h blank | 29 | 38 |
| of those, corrR equal to corrS | 12 | 17 |

(These counts are before the scoring rules: no hard-flag, truth-range or burn-in filter is applied.)

## Could not check

- Run times in the README (not timed).
- Production behaviour beyond the replay: 15-minute readings, resets, the browser's own state route.
- `src/model/shared-model.js` parity: the tool imports the server copy only, as the plan says.
- Whether hours with an unusual `span_h` (finding 4) should be in R: a specification decision, not a tool question.

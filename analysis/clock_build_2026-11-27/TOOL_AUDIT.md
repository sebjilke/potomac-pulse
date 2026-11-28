# Tool audit: `replay_clock.mjs` (`--clock=old|new`), 2026-11-27

Auditor: independent, did not write the change, did not see the implementer's report. Everything below was recomputed or rerun by the auditor. Scratch work: `/private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/clock_tool_audit/` (scripts in `py/`, own runs in `old/`, `new/`, `default/`). Node v24.12.0. Input `analysis/rising-limb-travel-backtest/hourly_backtest_data_v39.csv`, SHA-256 d1d3f6a515d0c90c1e0bc1b075c6b53977d34aa82e704e163b449785259c8c4f.

## Verdict: TOOL FIT FOR USE

The change does what the plan says and nothing else. Old mode reproduces the original byte for byte. The NEW run on disk is exactly what the tool produces. All 129,534 due times, validation hours, tau values and truths in the NEW shadow file match an independent recomputation from the input file, with 0 mismatches. The learning slot rebuilt independently matches the learn file row for row and the counts file in every total. No blocker and no tool defect found. One finding (F1) is about how the results must be read, not about the code: the later report has to state it in front.

## Findings

**F1 (MAJOR for the report, not a tool defect): in both runs the clock that is actually scored is a staircase of whole hours minus 11 minutes, not the formula.** The truth is read at tau = (first whole hour at or after the due time) minus 11 minutes, and estimates are made on whole hours, so the scoring lag (tau minus the estimate hour) can only take the values k + 0.817 hours. In NEW it takes exactly five values: 1.817 h (17,072 estimates), 2.817 h (45,003), 3.817 h (30,796), 4.817 h (24,256), 5.817 h (12,407). The scoring lag minus the formula's clock runs from -0.183 h to +0.817 h (NEW mean +0.276 h, median +0.277 h; OLD mean +0.313 h). At 19,880 cfs and above (clock just under 2.0 h, due at :59:37) every estimate is scored 10.6 minutes BEFORE its due time; just above a whole-hour boundary an estimate is scored up to 49 minutes late. Differences between the two clocks smaller than one hour are therefore partly invisible and partly exaggerated, and the effect is deterministic in flow (the same Q always lands on the same step), not random noise. This is the existing convention of the original tool and is applied identically in both runs, as the plan requires. What to do: state it in the report; treat the plan's common truths at exactly t + clock(Q) (PLAN 3.2) as the ones that show the formula itself, and the runs' own truths as the staircase.

**F2 (MINOR): status and other truth-hour columns change meaning with the clock, by design.** `status` differs on 422 rows (226 no_truth in OLD become predicted in NEW; 196 the other way), `truthInProdRange` on 458, check flags, EF stage and temperature at validation on thousands of rows. All are consequences of the different validation hour and are intended. What to do: any paired OLD vs NEW comparison on the runs' own truths must restrict to hours that have a truth in both runs (or say how it treats the others). Note that the total "Check 1 fired: 16,638" is the same in both counts files by coincidence: 882 + 114 rows lose the flag and 874 + 122 gain it; per year the counts differ.

**F3 (MINOR): the stored diff and a fresh diff differ only in the two header lines (relative vs relative-to-other-folder paths).** Body identical. Nothing to do.

No other finding. Specifically not found: any changed line not needed for the option; any change to the model call, its inputs, the bins, the gate, the window, the slot logic or the output order; any CSV column shift (every row of the NEW shadow file has 89 fields, 87 + the two appended); any change to `travelGFtoLF` (0 differing rows, still the production value).

## Checks

### 1. The diff
`diff -u` of `onset_correction_2026-11-25/tools/replay_onset.mjs` against `clock_build_2026-11-27/tools/replay_clock.mjs`: body identical to `tools/replay_clock.diff` (only headers differ, F3). Changed lines, all needed:
- `parseArgs`: default `clock: 'old'`; whitelist `old|new`.
- `CLOCK_COLS = ['clockQ', 'clockHrs']` (new export).
- `runHybrid` destructure gains `clock = 'old'`.
- `makeRecord`: `const dueMs` becomes `let dueMs` with the same old expression; in `new` only, `Q = inp.lf.v`, `Qc = min(20000, max(1400, Q))`, `clockHrs = 98.2 * Qc^-0.3935`, `r.clockQ`, `r.clockHrs`, `dueMs = t + clockHrs * HOUR_MS`. A guard throws on a non-positive or non-finite Q (cannot fire: `buildSeries` keeps only LF > 0 and `no_lf` returns earlier).
- `runHybridCli`: passes `clock`; shadow column list is `SHADOW_COLS` in old mode and `SHADOW_COLS + CLOCK_COLS` in new mode, used for both the plain and the switch output.
Formula: exactly PLAN section 2 (98.2, -0.3935, limits 1,400 and 20,000 cfs, held inside). Q: `usgsFromInputs(inp)` sets `data[GAUGES.lf].q = inp.lf.v`, which production `makeGFPrediction` reads as `lf.q` (`scheduled-update.js:935`, `:953`). The tool reads the same `inp.lf.v` it passes, so Q is the value handed to the model, not a later reading, not the truth, not the PoR-based flow of the non-convergence fallback. Under arm L that is the LF row at t - 1 h, or the last LF row at or before it if it lies within 48 h of t. `dueMs` is then the only thing that changes; it flows to `r.dueTs`, the returned `pred.dueMs`, the shadow queue key `ceilHour(dueMs)` and the learning slot (`T >= slot.dueMs`, `T - slot.dueMs > 2.5 h`, learn row `dueTs`), exactly as before.

### 2 and 3. Reruns, byte for byte

| Run (auditor) | File | Compared with | Result | SHA-256 |
|---|---|---|---|---|
| `--clock=old` | shadow_L.csv | onset_correction_2026-11-25/replay_L | identical | dcc63931841b537a834962b9a7c60e6edfd3b72b8bd491b43af89bbba0ba5aba |
| `--clock=old` | learn_L.csv | same | identical | be9c95c12ebb8dbf622f6ae1859830f63326bf026fdf31078e210e16c198b3e6 |
| `--clock=old` | bins_L.csv | same | identical | ad2a48e19344468d5960492a3d95a5d936ead578789388b4b2fc30f331978eea |
| option omitted | the three files | same | identical | same three |
| `--clock=old` | counts_L.txt, stdout | same | counts differ only in the command line; stdout identical | |
| `--clock=new` | shadow_L.csv | clock_build_2026-11-27/replay_NEW | identical | e0111ffcae8ffe135921fccc5db9a26e5d49e12ef9230f43b23dab489fdb9cc3 |
| `--clock=new` | learn_L.csv | same | identical | cebe8e728d7ba2ec669d5b00c63479cf62d4d01c81e7dadaa7651d5fc9f29750 |
| `--clock=new` | bins_L.csv | same | identical | e6d95c886cd9060a4710da8294a252971b15e8f8935a7148c965b79d1b9678b1 |
| `--clock=new` | counts_L.txt, stdout | same | counts differ only in `--outdir`; stdout identical | |

All runs: `--in=<input> --arm=L --gate=new --mode=hybrid`.

### 4. Due times recomputed from the input file
Script `py/indep.py` (Python, own code): reads `lf_discharge` (> 0 only), takes the held value under arm L (row t - 1 h, else last earlier row within 48 h of t), clamps, computes the clock, due (ms truncated for the ISO string), validation hour = ceil to the hour, tau = minus 11 min, truth = linear interpolation of hourly values placed at hour start + 22.5 min with the one-neighbour rule. Run on every shadow row that has a due time: **129,534 rows, 0 mismatches** in Q (also equal to `lfQ`), clockHrs (within 1e-12), dueTs, valHourTs, tauTs, status predicted/no_truth, truthFlow (within 1e-9). Selected rows (all also hand-checked against `bc` for the clock and against the raw CSV lines for the first, the after-gap and the steep-rise rows):

| Case | predTs (UTC) | Q held (source row) | clock h | due | val hour | tau | truth (kind) | file equal |
|---|---|---|---|---|---|---|---|---|
| Q < 1,400 | 2013-10-07 10:00 | 1,370 (09:00) | 5.676885 | 15:40:36.786 | 16:00 | 15:49 | 1,542.29 (interp of 1,465 and 1,640) | yes |
| lowest Q | 2023-09-07 09:00 | 377 (08:00) | 5.676885 | 14:40:36.786 | 15:00 | 14:49 | 462 | yes |
| exactly 1,400 | 2017-10-08 02:00 | 1,400 (01:00) | 5.676885 | 07:40:36.786 | 08:00 | 07:49 | 1,260 | yes |
| just inside low limit | 2013-10-07 08:00 | 1,410 (07:00) | 5.661008 | 13:39:39.628 | 14:00 | 13:49 | 1,378.83 | yes |
| just inside high limit | 2015-03-20 13:00 | 20,000 (12:00) | 1.993683 | 14:59:37.260 | 15:00 | 14:49 | 20,027.92 | yes |
| exactly 20,000 | 2011-12-04 14:00 | 20,000 (13:00) | 1.993683 | 15:59:37.260 | 16:00 | 15:49 | 19,533.75 | yes |
| Q > 20,000 | 2018-02-11 18:00 | 20,200 (17:00) | 1.993683 | 19:59:37.260 | 20:00 | 19:49 | 20,982.5 | yes |
| highest Q | 2018-06-05 08:00 | 174,000 (07:00) | 1.993683 | 09:59:37.260 | 10:00 | 09:49 | 173,779.17 | yes |
| after LF gap (filled) | 2019-12-04 05:00 | 3,750 (03:00; 04:00 missing) | 3.852389 | 08:51:08.601 | 09:00 | 08:49 | 3,830 (hi only; 08:00 missing) | yes |
| after long gap, no truth | 2013-09-07 04:00 | 3,860 (2013-09-05 04:00, exactly 48 h) | 3.808811 | 07:48:31.718 | 08:00 | 07:49 | none | yes |
| no truth | 2015-02-15 06:00 | 6,995 (04:00) | 3.014307 | 09:00:51.506 | 10:00 | 09:49 | none | yes |
| no truth | 2026-07-20 18:00 | 2,960 (16:00) | 4.228226 | 22:13:41.613 | 23:00 | 22:49 | none | yes |
| steep rise (>= 50% in 6 h) | 2015-12-26 11:00 | 20,450 (10:00) | 1.993683 | 12:59:37.260 | 13:00 | 12:49 | 20,800 | yes |
| steep rise | 2023-09-24 13:00 | 5,945 (12:00) | 3.213533 | 16:12:48.717 | 17:00 | 16:49 | 6,329.25 (6,210 to 6,480) | yes |

Candidate counts: Q < 1,400: 3,688 estimates; Q > 20,000: 11,028; held LF older than 1 h (after a gap): 1,588; no truth: 909; LF up 50% or more in 6 h: 953.

### 5. Raw estimates and the first corrected difference
Column by column over all 130,987 shadow rows (`py/cmp.py`): 0 differing rows in `rawFinalCFS`, `rawUnc`, `flowBin`, `flowState`, `travelGFtoLF`, `travelPoRtoGF`, `porEstimateCFS`, `efEstimateCFS`, `efWeight`, every input value, source time and age, `d6`, `thr6`, `p6Ts`, `p6Cfs`, `span_h`, `histShort`, `lfCap`, `statusDetail`. Header of NEW = header of OLD + `clockQ,clockHrs`.
First corrected difference: `predictedCFS` and `correctionApplied` at 2011-12-01 09:00 (OLD 20,774 / correction 0; NEW 20,754 / correction 20). Explained: the first estimate (07:00) is due 08:59:37 in NEW and learns at 09:00 (raw residual +100.83 cfs into 12000-25000_steady, count 1), before the 09:00 estimate is made; in OLD it is due 09:49:57 and learns at 10:00. With one observation the blend weight is 1/5, so `corrUsed` = 100.83 / 5 = 20.17, as the file shows. Estimates at 07:00 and 08:00 are equal in both runs.

### 6. The learning track (NEW)
Independent rebuild of the single slot (`py/slot.py`) from the auditor's own due times and own truth, hour by hour in the tool's order (validate, then new estimate), window 2.5 h (production constant `shared/model.js:872`), retry when no truth or truth outside 500 to 500,000:

| Quantity | Auditor | counts_L.txt | learn file |
|---|---|---|---|
| slots stored | 38,046 | 38,046 | |
| slot occupied when a new estimate came | 91,488 | 91,488 | |
| validations | 37,913 | 37,913 | 37,913 rows |
| learned | | 37,848 | 37,848 (bins rows 37,848) |
| hard-skipped | | 65 | 65 |
| retries | 396 | 396 | |
| dropped, missed 2.5 h | 133 | 133 | |
| slot pending at end | 0 | 0 | |

The rebuilt (predTs, validation hour) sequence equals the learn file in all 37,913 rows. 40 rows are validated later than the first whole hour after the due time, all explained by retries in the rebuild; maximum delay 2.49 h (inside the window). No estimate enters the slot before the previous one has left it (0 overlaps). Every learn row's `dueTs` equals the auditor's due time and `tauTs` = validation hour - 11 min. Also learned while soft-flagged 3,962, clamped 628 (from the learn file; the counts file does not list these for the new gate).
For reference OLD: slots 23,764, validations 23,688, learned 23,651, retries 222, dropped 76. NEW learns about 60% more often because the slot frees sooner; intended.

### 7. Accidental differences
- Status and truth-hour columns: see F2. Intended.
- Several validations in one hour: NEW has 752 validation hours with more than one shadow estimate (max 3; OLD 3,652, max 6) and 1 case where a later estimate is validated before an earlier one (OLD 164). Shadow validations only read the bins, so their order changes nothing; the learning slot holds one estimate, so its order cannot be affected.
- Shortest clock (1.9937 h) against the hour grid and tau: minimum tau - t = 1.817 h. The lower hourly row used for the truth is always at least t + 1 h (OLD: t + 0 h), and the model holds LF row t - 1 h, so no truth comes from before the estimate or overlaps the reading the model held. The price is F1 (scored 10.6 min early at high water).
- CSV: all 130,987 NEW rows have 89 fields; `cell()` strips commas; the two columns are last and blank on rows without an estimate.
- `travelGFtoLF` still holds the production value on every row (0 differences), so in NEW `dueTs - predTs` no longer equals `travelGFtoLF`; `clockHrs` is the column to use.
- Guard `CLOCK: bad Q` never fires (run completes; Q always > 0).

## What this replay cannot show (for the report)
1. Hourly medians instead of 15-minute readings, both for the Q the clock uses and for the truth; a clock difference of minutes is below the data's resolution.
2. The staircase of F1: whole-hour estimates plus "first whole hour at or after due minus 11 minutes" scores at k + 0.817 h only; production validates at the first cron run after the due time against the last USGS value at that moment (`scheduled-update.js:1236`), with a cron minute and reading age the replay does not model.
3. The truth is an interpolation of hourly medians; production scores against one unrounded instantaneous reading.
4. Q under arm L is the LF row one hour old, filled up to 48 h back after a gap (1,588 estimates held an older value); production `lf.q` is typically 10 to 70 minutes old.
5. Shadow rows score every hour's estimate; production stores only the estimate that finds the slot free (`skipped_in_window`), as in the learning track.
6. Inherited from the original tool (onset TOOL_AUDIT and replay_lag README): bins start empty; critical-ice skip, stage-error bins, advisories, forecasts and logs not replayed; server model copy only; 48 h fill for all channels.
7. A shorter clock also moves the gate's inputs (EF stage, temperature at the validation hour) and the learning rate (60% more learning events); a difference between runs mixes the clock with these.

## Could not check
- Whether the formula's constants (98.2, -0.3935, 1,400, 20,000) are right: taken from the approved plan, not re-derived.
- Production behaviour of the future code change (PLAN section 5): not built; this audit covers the replay only.
- Run times: not measured.

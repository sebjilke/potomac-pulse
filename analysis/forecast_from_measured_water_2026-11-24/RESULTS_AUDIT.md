# Results audit (third auditor), Stage 1: forecast from measured upstream water

2026-11-24. Auditor 3 (Opus). I ran none of the analysis and wrote none of its documents. I changed no existing
file. Scratch code and copies: `/private/tmp/audit3_forecast/` (`audit3.py`, `lookahead.py`, `explore.py`,
`usgs/`).

**Verdict: CONFIRMED WITH CAVEATS.** Every number that decides a verdict reproduces exactly. The verdicts follow
the plan's rule. But the 12 hour "ADDS INFORMATION" is fragile. The measured-water forecast does not beat the
app's own estimate held flat. The 24 hour result is a low-water, wave-season loss, not "no information". The
report must say all three.

## Findings (most serious first)

### 1. MUST. The 12 hour verdict holds on the pooled record only. It fails the same test in the recent era, the second half, the wave season and at low water.

- Pooled: `D(12)` = 1.465, 95% interval [1.140, 1.797]. Condition 1 needs a lower bound of 1.0. Margin: 0.14 point.
- Same statistic, same bootstrap, on subsets (from `intervals.csv`, and the halves recomputed by me; all
  exploratory, not a retuning):

  | subset, 12 h, inside the lead | n | D | lower | upper |
  |---|---:|---:|---:|---:|
  | era 2012 to 2018 | 28,526 | 1.729 | 1.155 | 2.332 |
  | era 2019 to 2026 | 44,180 | 1.295 | **0.919** | 1.690 |
  | first half (to 2019-08) | 30,592 | 1.811 | 1.268 | 2.384 |
  | second half (from 2019-09) | 42,114 | 1.214 | **0.830** | 1.607 |
  | wave season (15 Sep to 15 Dec) | 24,657 | 0.578 | **0.036** | 1.152 |
  | outside the wave season | 48,049 | 1.921 | 1.568 | 2.291 |
  | flow range 0 to 3,000 | 21,604 | **-0.822** | -1.187 | -0.489 |
  | flow range 3,000 to 6,000 | 26,794 | 1.448 | 1.095 | 1.813 |
  | flow range 6,000 to 12,000 | 23,491 | 3.422 | 2.900 | 3.994 |
  | wave season and Little Falls below 3,000 | 14,420 | **-1.098** | -1.523 | -0.733 |

- The point estimate is stable when one year is left out: 1.37 to 1.57 (15 years).
- Reading: the gain is real on average. It comes from 3,000 to 12,000 cfs outside the wave season. Below 3,000
  cfs the measured-water forecast is significantly worse than "no change" at 12 hours. In the recent era and in
  the recent half alone, the pre-registered condition 1 would not be met.
- The verdict stands under the plan (subsets are descriptive). The report must state this fragility next to
  the verdict.

### 2. MUST. Inside the lead, the measured-water forecast does not beat the app's own estimate held flat.

`REF_HELD` is `predictedCFS` at the issue hour held to the target. The app already has it at issue time. It
already contains the time-shifted Point of Rocks reading. Same cases (`metrics.csv`, period A, inside, all):

| h | P-LF ("no change") | R-LF (measured water) | REF_HELD (estimate held) |
|---|---:|---:|---:|
| 6 | 7.942 | 6.890 | **6.468** |
| 12 | 10.340 | 8.874 | **8.630** |
| 24 | 13.432 | 13.995 | **11.769** |

- So "information beyond no change" inside the lead is mostly information the app's estimate already uses.
- The comparison is descriptive (plan section 4) and has no interval. R-LF has no bias correction (finding 4);
  a corrected R-LF might close the gap. That is a question for Stage 2, not a finding.
- Beyond the lead the order flips (12 h: R-LF 6.98 against REF_HELD 10.08).
- The report must not say or imply that measured water is new information for the app inside the lead.

### 3. MUST. At 24 hours "ADDS NOTHING" means "significantly worse", and only at low water in the wave season.

- `D(24)` = -0.563, interval [-1.154, -0.012]. The whole interval is below zero.
- Outside the wave season: +1.184 [0.630, 1.709]. Inside it: -2.011 [-2.700, -1.360].
- By month of issue (my computation, 24 h, inside): positive in January (0.96), May to August (1.01 to 1.87);
  negative September (-0.34) to December (-1.76, -2.42, -2.11).
- July and August are low water too, and there the forecast gains. So low flow alone does not explain the loss.
  The season does.
- Beyond the lead at 24 h: +4.757 [4.368, 5.167] (high flows, all measured water used).
- 73% of 24 h inside-lead cases are in the 0 to 3,000 bin. The 24 h verdict is a statement about low water.
- The report must not say "measured water is useless at 24 hours".

### 4. SHOULD. The measured-water forecast is biased low at every horizon, also in steady water.

Mean signed error inside the lead, period A: R-LF -1.44 / -1.92 / -3.01 (6, 12, 24 h); P-LF +0.54 / +0.42 / -0.63.
In steady water at 12 h: R-LF -1.51, P-LF +1.39. The plan calls "too low" the unsafe direction. Condition 3 tests
only rising water, where R-LF is less low than P-LF (passes). The cause is not established by the study. The
report should state the bias and that its cause is open.

### 5. SHOULD. Period B's 6 hour loss is a low-water, late-summer effect. It does not contradict period A.

- Period B, 6 h, inside: P-LF 9.85, R-LF 13.07, D -3.22 [-5.77, -0.32] (12 weekly blocks only).
- Split at 8 October (USGS later revised Point of Rocks from that date; exploratory): before, n = 984,
  D = -5.34; from 8 October, n = 770, D = -0.50. The loss is NOT in the revised weeks.
- 1,119 of 1,754 cases are below 3,000 cfs. Most of the period lies in the wave season.
- Period A shows the same thing: 6 h, wave season and Little Falls below 3,000: D = -3.17 [-3.81, -2.56];
  flow range 0 to 3,000: -2.50 [-3.03, -2.00].
- So B is consistent with A's subsets. It weakens no period A verdict. It does confirm that at low water the
  method loses, and that the 6 hour "UNCLEAR" hides a gain at medium and high flows and a loss at low flows.

### 6. SHOULD. Exploratory evidence that timing (daily wave, travel time) drives the low-water loss.

I replaced each Point of Rocks value by its trailing 24 hour mean (hours at or before `u`, no look-ahead).
Exploratory, not a candidate arm.

| h, inside | D, raw | D, smoothed | wave season raw | wave season smoothed |
|---|---:|---:|---:|---:|
| 6 | 1.053 | 0.656 | -1.166 | 0.007 |
| 12 | 1.465 | 0.530 | 0.578 | 0.229 |
| 24 | -0.563 | -0.192 | -2.011 | -0.513 |

Smoothing removes most of the wave-season loss but also most of the gain. This fits a timing error: a wave
shifted by a wrong low-water travel time lands at the wrong hour (plan sections 9 and 11). It does not prove
it. The sub-hour window mismatch of the specification review (mean +0.06 h) is too small to explain it.

### 7. NOTE. "Inside" against "beyond" the lead is a flow split, not a lead effect.

Beyond the lead D is 6.29 (6 h), 5.68 (12 h), 4.76 (24 h), all with lower bounds above 4. The plan expected
"little or no gain" there (section 9). Beyond-lead cases are high flows with short travel times, where "no
change" is poor. The report should not read Q2 as "lead matters"; flow regime is confounded with it. The
decision cells (inside) therefore select the lower flows, where R-LF is weakest.

### 8. NOTE. Independence of the analysts: the code is independent; the process cannot be checked from the files.

- SHA-256 of all eight files, `py/` against `r/`: identical (e.g. `verdicts.csv` 76b29306...e890,
  `forecasts_A.csv` 51ac0135...1de, `intervals.csv` 51d5f5f5...6d53).
- The two scripts are different programs. Python loops row by row with a `Row` class, `dict` lookups and
  `math.fsum`. R is vectorised with `match()`, `rowsum()`, a resample count matrix and `M %*% X`. Judgment
  calls differ (C9 scope, C12 blank handling). Neither is a translation of the other.
- Neither reads the other folder: paths are built from the script's own folder (`py/run_all.py` lines 8-11,
  44-51; `r/run_all.R` lines 7-11, 290-295); no reference to `py/` or `r/` of the other side.
- Byte identity is plausible: the specification fixes every format, order and rounding (`%.6f`).
- File times: the final scripts were saved at 12:58:24 and 12:58:42 and run at the same time. Whether the agents
  were really blind is a process fact; I cannot verify it from the files.

### 9. NOTE. Regeneration from scratch matches byte for byte.

Copies under `/private/tmp/audit3_forecast/run_py/` and `run_r/` (each with only its own script and the
inputs, same relative layout). `python3 -I py/run_all.py`: exit 0, 40.1 s, 0 violations.
`Rscript r/run_all.R`: exit 0, 17.9 s, 0 violations. All 16 regenerated files equal the files on disk
(`cmp`). (The analysts' reports say 87 s and 40 s; their runs were simultaneous.)

### 10. NOTE. No look-ahead: confirmed mechanically and by reading.

- `lookahead.py` streamed both forecast files against the raw inputs. Period A: 474,736 rows; period B: 7,104
  rows; 0 violations of: source hours equal the issue row's; `porSrcTs <= t - 2 h`; `lfSrcTs <= t - 1 h`;
  `uStarTs` and `uLfTs <= porSrcTs`; `uLfTs <= histSrcTs <= uStarTs`; `uStarTs = min(hist + h, por)`;
  `inside` rule; `qStar`, `qLf` equal the hourly file at those hours; `rLF`, `errR`, `errP` recomputed; `truth`
  equals `truthFlow` of row `t + h`; `targetTs = t + h`.
- The newest Point of Rocks hour any forecast used is 2 hours before issue (258,074 scored cases in A), never
  less.
- C12 recomputed by me on the real files: A 125,099 predicted rows, B 128,595; 0 `porQ` mismatches, 0
  `historicPorCFS` differences above 0.5.
- Code: R's `forecast_fn(lfQ, qstar, qlf)` gets three numbers only (`r/run_all.R` 67-69). Python's
  `forecast(r, h, Q)` gets the whole issue `Row`, which carries the issue row's own `truthFlow` (a value from
  the future: Little Falls one travel time later). Lines 217-249 do not read it; truth is read only from the
  target row (`tr.truth`, lines 320, 356). Not a leak, but the Python report's "receives only the issue row's
  non-truth fields" is not literally true.

### 11. NOTE. Deviations of method from the plan; none can change a verdict.

- Condition 4 uses all flows outside the season; plan section 7 defines the season subset at Little Falls
  below 3,000. Ruled before any run (specification section 14). Irrelevant: condition 1 fails at 24 h. (Both
  versions have lower bounds below 1.0: 0.630 and 0.556.)
- Q4: the plan says P-LF "on every hour of period B"; the specification scores statuses 8 to 13 (1,757 of
  1,776 at 6 h; the rest have no truth or are not predictions). At 6 h `rel_diff` is 0.217 against the 0.2
  cut, close but not decisive. Q4 carries no decision.
- Plan section 1 says 24 h is inside the lead in 24% of hours below about 3,060 cfs. Observed: 26% of scored
  cases, and 7,581 inside cases in the 3,000 to 6,000 bin (`flowBin` is the estimate's bin, not Little Falls').
- Everything else matches the plan: arms, `u*`, `u_LF`, lead flag, burn-in from 2012-12-01, the 13 statuses,
  pairing (P-LF, R-LF, R-LFm on identical cases), subsets, monthly blocks, 10,000 resamples, decision rule.
- Verdict logic by hand from `verdicts.csv`: 6 h: lower 0.701 < 1, upper 1.397 >= 0.5: UNCLEAR. 12 h: lower
  1.140 >= 1; rising worse by -2.585 <= 0.5; signed R -6.512 >= P -9.740: ADDS_INFORMATION. 24 h: lower -1.154
  < 1; upper -0.012 < 0.5: ADDS_NOTHING. Overall: ADDS_INFORMATION at 12: PROPOSE_STAGE2. Correct.

### 12. NOTE. Data integrity.

- Input SHA-256 values equal the specification, `replay_lag_2026-11-17/README.md` line 53 (`shadow_L.csv`
  b6a917c0...), its line 15 (v361 b247c0be...) and `replay_B/README.md` (549f2006..., d1d3f6a5...). Events
  978c6c2f..., draws 4d5f1fcd....
- `git log 81c5c78..HEAD -- netlify/functions/shared/model.js netlify/functions/scheduled-update.js`: empty;
  no uncommitted changes. `git diff --stat 81c5c78 HEAD -- netlify src`: only `CHANGELOG.md` and
  `tech-appendix.md`. The harness was committed once (20233b3) and not changed since.
- `counts.csv`: every horizon sums to its TOTAL (A 118,684; B 1,776), i.e. 474,736 and 7,104 cases, equal to
  the rows of the forecast files. No silent drop.
- The forecast files, `replay_B/*.csv` and `tools/boot_uniforms.csv` are git-ignored. Their provenance rests on
  the generating commands and recorded hashes.

## Independently computed decision numbers (period A, inside the lead)

My code: `/private/tmp/audit3_forecast/audit3.py`, written from plan sections 4 to 8 and the specification
(own parser with `strptime`, own status filter, own bootstrap). Analysts' values from `verdicts.csv`,
`metrics.csv`, `intervals.csv`. All differences are 0 at 6 decimals.

| quantity | h = 6 mine / analysts | h = 12 mine / analysts | h = 24 mine / analysts |
|---|---|---|---|
| n inside | 102,991 / 102,991 | 72,706 / 72,706 | 29,356 / 29,356 |
| MAE P-LF | 7.942491 / 7.942491 | 10.339590 / 10.339590 | 13.432473 / 13.432473 |
| MAE R-LF | 6.889686 / 6.889686 | 8.874286 / 8.874286 | 13.995085 / 13.995085 |
| D | 1.052805 / 1.052805 | 1.465304 / 1.465304 | -0.562613 / -0.562613 |
| D interval | 0.701090, 1.396769 / same | **1.140350, 1.796728 / same** | -1.154190, -0.012373 / same |
| rising n | 14,996 / 14,996 | 10,436 / 10,436 | 3,169 / 3,169 |
| rising MAE R-LF minus P-LF | -2.162377 / -2.162377 | -2.585290 / -2.585290 | 0.241724 / 0.241724 |
| rising signed R-LF | -4.104830 / -4.104830 | -6.512353 / -6.512353 | -10.111787 / -10.111787 |
| rising signed P-LF | -7.913274 / -7.913274 | -9.740373 / -9.740373 | -11.233515 / -11.233515 |
| D outside wave season | | | 1.183979 / 1.183979 |
| its interval | | | 0.630300, 1.708889 / same |

I redid the block bootstrap for `D(12)` (and for 6 h, 24 h, 24 h out-of-season, and six 12 h subsets) from
`tools/boot_uniforms.csv` with `j = (n * 163) // 10^12`, 0 skipped resamples, type 7 percentiles. All equal.

## Spot-check against live USGS (Point of Rocks, 01638500, 00060)

Service: `https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items?monitoring_location_id=USGS-01638500&parameter_code=00060&time=<H>:00:00Z/<H>:59:59Z&limit=1000&f=json`
(keyless, worked first time). Median of the readings inside the hour, compared with `por_now`.

| hour (UTC) | file | readings (USGS, status) | USGS median | file value | difference |
|---|---|---|---:|---:|---:|
| 2013-03-15 12:00 | v361 | 30600, 30500, 30300, 30200 (Approved) | 30400 | 30400.0 | 0 |
| 2015-07-04 06:00 | v361 | 10000, 10000, 10000, 9990 (Approved) | 10000 | 10000.0 | 0 |
| 2018-05-20 18:00 | v361 | 99100 x 4 (Approved) | 99100 | 99100.0 | 0 |
| 2020-02-10 03:00 | v361 | 28000, 27900, 27900, 27800 (Approved) | 27900 | 27900.0 | 0 |
| 2023-09-01 15:00 | v361 | 1310, 1290, 1290, 1290 (Approved) | 1290 | 1290.0 | 0 |
| 2026-03-10 09:00 | v361 | 15400, 15300, 15200, 15200 (Approved) | 15250 | 15250.0 | 0 |
| 2026-08-30 00:00 | v39 (period B) | 2860 x 6, 2890 x 6 (Provisional, 5-minute) | 2875 | 2875.0 | 0 |
| 2026-09-15 12:00 | v39 (period B) | 1740 x 12 (Provisional) | 1740 | 1740.0 | 0 |

8 of 8 equal. All outside 8 October to 13 November 2026. The match also confirms the hour key (hour start, UTC).

## Limits the report must state

- The verdict is about information beyond "Little Falls held". It says nothing about beating today's forecast
  (plan sections 8 and 11). Q4 found the visitors' sample not comparable at every horizon; no side-by-side.
- Inside the lead, the app's own estimate held flat already scores better than the measured-water forecast at
  6, 12 and 24 hours (descriptive).
- The 12 hour gain rests on a lower bound 0.14 point above the threshold. It comes from 3,000 to 12,000 cfs
  outside the wave season. It does not meet the threshold in 2019 to 2026 alone, in the second half of the
  record, or in the wave season, and it is negative below 3,000 cfs.
- At 24 hours inside the lead the forecast is worse than "no change" (interval wholly below zero), driven by
  September to December; outside the season it gains about 1.2 points.
- R-LF runs about 1.4 to 3 points too low on average (the unsafe direction); cause unknown.
- Inside against beyond the lead is confounded with flow.
- Low-water travel times are unconfirmed; the forecast is measured with today's travel times.
- Period B: 10 weeks, 12 blocks, provisional values as of 10 November, mostly low water; descriptive only.
- Hourly medians, about 22 minutes of look-ahead in every hourly value (same for all arms).

## What I could not check

- Whether the two analysts were in fact blind to each other during the work (process, not files).
- The correctness of the replay tool itself; I relied on its earlier audit and the regression recorded in
  `replay_B/README.md`. I did not rerun the tool.
- Period B values between 8 October and 9 November against USGS's revised record (excluded by the plan).
- The full bootstrap for all 1,296 interval rows; I redid 10 cells, all equal.
- Whether a bias-corrected or better-timed R-LF would beat the held estimate (a Stage 2 question).

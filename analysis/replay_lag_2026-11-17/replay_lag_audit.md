# Independent audit of the replay results (third auditor)

Auditor: a fresh subagent (Opus) that ran none of the analysis, read-only, 2026-11-18 UTC. Text extracted by script from the auditor's final report, not retyped.

**No error in the tool, the specification or either analysis changes a headline number.** Every headline reproduces exactly, to 4 decimals or better. The finding is real for the current model, but the cause is not the expected one: the fresh arm does not lose through delta over-shoot. Nearly all of its loss comes from hours where it already calls the water "rising" while the lagged arm still calls it "steady".

My scripts and outputs are in /private/tmp/claude-503/-Users-sebjilke/252f7c3c-5965-4854-a165-14468fc066da/scratchpad/audit6/ (cmp.py, score.py, integ.py, spot.py, spot2.py, mech.py, more.py, truth.py, bs.py, trans.py; the live USGS responses are in dl/). I made no repository writes and used 11 GETs.

## (A) Verification table

| Check | Result | Evidence |
|---|---|---|
| Python vs R, my own comparison | PASS | 361 and 370 keys, 329 common, all numeric. Largest difference 4.54e-9 (`transient.formula_first_pct_2023-01-01`). No NaN mismatches. |
| Keys in only one file | PASS, none matter | Python only (32): lag-check names. R only (41): differently named lag checks, `counts_sens_*` and the switch predTs as hours. Every lag mismatch in both files is 0, and the per-arm nominal-row counts are identical (for example Point of Rocks 123,002 F and 122,995 L in both). |
| Third computation, my code from the spec | PASS | Counts 125,098 / 70 / 356 / 41 / 0 / 124,631. Primary: n 11,587, +0.3511 [+0.2170, +0.4904], raw +1.2587. Affected floods: 1,616, +0.3130 [+0.1036, +0.5021], raw +1.0296. All affected: 29,007, +0.1961 [+0.1310, +0.2635], raw +0.5058. All pairs: 124,631, +0.0394 [+0.0091, +0.0700], raw +0.1409. All exact. |
| Deviations in the analysts' scripts | PASS | Pairing, the exclusion order, affected / rising / falling / flood, the pooled bootstrap and percentile type 7 match the spec in both. Their declared ambiguities (cell written with "_" not "|", the 169 h event rule, which row supplies the branched-check cell) touch the transient only; my independent rebuild gives the same transient numbers. |
| Row accounting | PASS | Source: 126,916 rows, unique, sorted, all on the hour. Shadow files: 127,463 hours = the full grid. Predicted: F 125,117, L 125,099, both 125,098. The 20 unmatched hours are explained (L hits a data gap one hour earlier → `no_por`; or `no_truth` because the arms' validation hours differ). No duplicate `predTs`. |
| Months | PASS | The scored pairs cover 175 months, the same set as `months.csv`. No resample skipped. |
| Truth rule | PASS | My own interpolation reproduces `truthFlow` on 20,000 of 20,000 pairs. |
| Live USGS spot checks | PASS | Details below. |

Spot checks, live service hourly median vs source CSV, then the lag used:
- Point of Rocks fast rise, 2025-05-14 15:00 to 20:00: 16,700, 18,750, 25,850, 37,550, 50,000, 61,350, all equal. At predTs 19:00, F used 37,550 (18:00 row) and L used 25,850 (17:00 row).
- Little Falls flood onset, 2025-05-15 00:00 to 05:00: 27,100 to 88,150, equal. Also 2024-01-11 01:00 to 05:00: 45,850 to 57,900, equal.
- Edwards Ferry stage, 2025-05-14 and 2020-12-25: equal, except medians ending in .005 rounded to 2 decimals (8.115 vs 8.12; 12.385 vs 12.38), which does not matter. At predTs 2020-12-25 14:00, F used 12.06 (13:00 row) and L used 11.88 (12:00 row).
- Goose Creek, 2025-05-14 15:00 to 20:00: equal. F and L at the right lags.
- Point of Rocks 2018-06-03 and 2012-03-02: equal, lags correct.
- Two primary rows with large |d_corr|:
  - 2025-02-15 06:00: Point of Rocks 13,700 (F) vs 13,600 (L), and Little Falls truth 14,200, all equal to the service.
  - 2024-07-13 13:00: Point of Rocks 1,660 (F) vs 1,650 (L), equal.

## (B) The rule's verdict and its fragility

Applied mechanically:
- Primary upper end 0.490 < 0.5 and affected-flood upper end 0.502 < 1, so MOVE holds.
- DO NOT MOVE does not apply (lower end 0.217 is not above 0.5).
- The median absolute offset is 1.37 ≤ 3, so no safeguard.
- **Verdict: MOVE.**

MOVE here is a non-inferiority result: fresh is worse, but by less than the 0.5-point floor. It does not mean fresh is better.

How fragile the 0.490 is:
- Monte Carlo error is small: three new seeds give 0.489 to 0.493.
- Other blockings agree: ISO weeks 0.481, rise episodes 0.488, quarters 0.485.
- The pre-registered sensitivity runs all stay below 0.5: `sens_F0L0` 0.4945, `sens_age` 0.4918, `sens_12mo` 0.4710, `sens_gateold` 0.3640. Their flood upper ends are all ≤ 0.502.
- **Either era alone would fail:** era 1 0.512, era 2 0.586. Each era has half the data, so these would read INCONCLUSIVE.
- **Truth one hour earlier would fail:** 0.525.
- The verdict holds, but only just.

## (C) Stress test

**a. Mechanism.** The loss is not delta over-shoot. It is the state classifier plus the per-state bins.
- Pairs where F is rising and L steady: n 2,987, d_corr +1.83 [+1.45, +2.25]. That is +0.47 of the +0.35 total.
- Pairs where both arms are rising: n 8,209, d_corr −0.10.
- By `pct`: below 5%, d_corr is +0.86 to +1.76, and state differs in 71 to 90% of these pairs. At 5% and above, d_corr is −0.08 to +0.08.
- The raw delta does over-shoot in F: raw bias at `pct` ≥ 20% is +20.5 (F) vs +16.8 (L). The bins absorb it, though: corrected bias is −0.89 (F) vs −1.84 (L).
- **Signed errors: the fresh arm does not over-predict once corrected.** Both arms under-predict (−1.89 vs −2.44).
- What drives the loss: in the flipped pairs the raw estimates are almost equal (d_raw +0.27). F applies the rising-bin correction, 6.86% of raw against 5.24% for L's steady bin, and over-corrects gentle onsets. Example, 2025-02-15 06:00: raw 14,695 vs 14,682; F's rising bin subtracts 4,247 cfs (error −26%), L's steady bin subtracts 583 (error −0.7%).
- By delta gate: both off, n 1,946, +1.79; both on, n 7,947, +0.11.
- Flow bin and travel time: positive in every group (+0.14 to +0.64), no concentration.

**b. Truth timing.**
- Truth at each arm's own validation-hour row: +0.318 [0.185, 0.458].
- Both arms scored at F's tau: +0.350. Both at L's tau: +0.353.
- tau −2 h / −1 h / +1 h / +2 h: +0.428 / +0.389 / +0.294 / +0.221.
- The sign never changes. The size moves between 0.22 and 0.43.

**c. Hourly medians.**
- Where Point of Rocks rose ≥ 5% in one hour (n 1,565): −0.171 [−0.432, +0.088]. Fresh is better or neutral there, and its corrected bias is smaller (−2.0 vs −4.1).
- 0 to 2% per hour: +0.853. Under 0: −0.90.
- `F0`/`L0` (one hour closer to the truth): +0.383, much the same.
- Smoothing mostly blunts the fast rises where fresh helps, so it, if anything, understates fresh's benefit. Gentle onsets are what decide the result.

**d. Confounding by state or bin.**
- Primary, same state and bin: n 7,842, **−0.138 [−0.266, −0.011]** (fresh significantly better).
- Primary, state or bin differs: n 3,745, +1.376 [+1.07, +1.70].
- Floods: same state and bin +0.133 (interval spans 0); state differs +2.38 (n 87).
- Pairs that are not affected: −0.008, so the two arms' separately learned bins add almost no noise.
- So yes: the whole result is driven by the arms applying different learned corrections.

**e. Raw versus corrected.** The bins remove about 70% of the raw loss (+1.26 → +0.35). In same-state pairs they remove more than all of it (raw +1.68 → corrected −0.14). The leftover loss lives in the classification boundary, which no retune of the delta gain would fix. A model retuned for fresh inputs (state threshold or onset handling) would probably erase or reverse the loss. That is untested.

**f. Anything else.**
- The real lag difference is 55 min, not 60; scaled by 55/60 the primary is about +0.32. This scaling is not pre-registered.
- The replay classifier spans (6 h fresh vs 5 h lagged) resemble production's (5.8 vs 4.9 h), so the boundary effect should carry over to production.
- I found nothing that reverses the sign.

## (D) Judgement

The statement "a fresher Point of Rocks reading does not improve, and slightly worsens, the estimate on rising water under the current model" is supported, with three corrections:
1. **The loss comes from gentle-rise onsets.** Fresh inputs flip the state to "rising" about an hour earlier, and the rising bins over-correct small rises.
2. **On fast rises and wherever both arms agree on state, fresh is neutral or slightly better.** Its large-miss share is also marginally lower (6.33% vs 6.44%).
3. **The verdict passes by 0.01 point** and fails in either era alone or with the truth one hour earlier.

What the owner should be told: moving the job to minute :10 is allowed by the pre-registered rule (MOVE), but it buys no accuracy. It costs about 0.35 points of mean absolute error on rising hours (9.03 vs 8.67). The case for moving must rest on the non-accuracy ground in the plan (late-batch misses). The switch can cause a one-off shift of up to about 12% at the first rise in a cell, so keep the dated first-rise check even though no safeguard is triggered.

## (E) Transient (step 7) and what I could not verify

Transient, rebuilt with my own code over all 37 events (more than the 10 asked):
- Median absolute offset 1.366, median signed −0.95, 90th percentile 4.715. All match the analysts.
- Sign convention: estimate = raw − EMA. After a switch the estimate changes by (ema_F − ema_L)/raw, so the realized value is the formula with the sign flipped. The rule uses absolute values, so this has no effect.
- The 2023-01-02 case (−11.7%) is not a thin-bin artefact. Cell `6000-12000_rising`: F's EMA was −602 (count 782, last update 2022-12-23), L's +571 (count 696, last update 2022-11-22). With alpha 0.3, the EMA tracks its last few updates, and F learned a December rise that L did not.

Not verified:
- Accuracy at 15-minute resolution and at production's real input ages.
- Ice periods (gaps in the data, not replayed as ice).
- Provisional vs approved data revisions.
- Production's single-slot learning pace beyond the hybrid replay.
- Whether a retuned onset rule would reverse the sign (untested inference).
- The live-service checks cover 34 hourly values at 11 gauge-windows, not the whole record.

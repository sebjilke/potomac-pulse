# R analysis (blind) of ANALYSIS_SPEC.md

Run (from anywhere): `cd analysis/replay_lag_2026-11-17 && /opt/homebrew/bin/Rscript r/analysis.R`
Output: `r/metrics_R.csv` (population,metric,value). Deterministic (no randomness; bootstrap indices from the supplied file). Runtime about 25 s.
Versions: R 4.5.2, base R only (data.table is NOT installed; no other packages used).

## Ambiguities and choices
1. Cell format: bins files write `<flowBin>_<flowState>` (underscore, e.g. `12000-25000_steady`), not `|`. Matched on the underscore form.
2. Event start: "168 consecutive hours with no flood row before" read as clock hours h-168..h-1 all clear, i.e. previous flood row at least 169 h earlier. Rows with blank LF are not flood rows. Source columns: `timestamp` (UTC, parsed with tz=UTC), `por_now` (Point of Rocks flow), `lf_discharge` (Little Falls flow).
3. Rise start: window E-168..E inclusive; both rows present with non-blank `por_now`, both flows > 0 (spec says positive PoR flow, applied to h and h-1).
4. Transient first rising scored row: from shadow_F restricted to the scored set, `flowState_F == "rising"`, predTs >= S (hour-aligned). Offset uses the F row's cell and rawFinalCFS. The "last row with ts <= S": latest ts, ties broken by file order.
5. Branched check: "that row's cell and rawFinalCFS" taken from the shadow_F row (same predTs), not the switch row. Rows must be `predicted` in both and `rising` in the switch file. Formula k=1 with S = midnight UTC of the file date. `realized_first_predTs_hr_<date>` is the predTs as hours since epoch (metrics file is numeric only); the ISO strings are 2015-01-04T11:00:00.000Z, 2019-01-01T20:00:00.000Z, 2023-01-02T08:00:00.000Z. Switch rows are not restricted to the scored set.
6. Sens runs also report `counts_sens_*` population counts (extra rows, section 1 counts for F0L0 and gateold; n_scored for age and 12mo). sens_age: blank ages are not excluded.
7. Lag check (section 9): "lag_rows" = predicted rows in F plus L (also per arm: `lag_rows_F`, `lag_rows_L`), including burn-in rows. Value check: given value equals the source value (column por_now / ef_stage / goose / lf_discharge) at the row whose timestamp is the stated SrcTs; a blank SrcTs with blank value counts as a match; tolerance 1e-9 relative. Timestamp check: where the source row at the nominal lag exists with a non-blank value for that column, SrcTs must equal it. Names: `lag_mismatch_<arm>_<porQ|efStage|gooseQ|lfQ>_value`, `lag_mismatch_<arm>_<por|ef|goose|lf>_ts_nominal`, `lag_nominal_rows_<arm>_<input>`. Goose source column is `goose`.
8. Pairing on predTs: inner join; booleans NA treated as not 1/0 for exclusions; `flowState`/`flowBin` blanks compared as missing.
9. Extra metric `boot_skipped` per population (0 everywhere that matters is reported in the file).
10. Bootstrap: months drawn are matched to months.csv labels; resamples via a count matrix times per-month sums and counts.

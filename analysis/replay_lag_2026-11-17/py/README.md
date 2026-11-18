# Python analyst (blind)

Run (from anywhere, deterministic, ~40 s, writes only here):
    python3 analysis/replay_lag_2026-11-17/py/analysis.py
Outputs: `metrics_python.csv` (population,metric,value), `metrics_python_text.csv` (string-valued extras: the predTs of the first switch row).

Versions: Python 3.14.7. pandas and numpy are NOT installed; standard library only (csv, statistics, math, bisect, datetime). Percentiles: own type-7 implementation (equals numpy default).

## Ambiguities and choices
1. Source columns used: timestamp (`YYYY-MM-DD HH:MM`, taken as UTC), PoR flow = `por_now` (`por_lagged` ignored), LF flow = `lf_discharge`, EF = `ef_stage`, Goose = `goose`.
2. Cell format: bins files write `<flowBin>_<flowState>` (e.g. `12000-25000_steady`), not `|`; I matched on that (flowBin + "_" + flowState).
3. Event rule: event at E if no present row in hours E-168..E-1 has LF >= 50,000 (i.e. last flood row at least 169 h earlier). Events before 2012-12-01T05:00Z dropped after detection (40 detected, 37 kept).
4. Rise-start search: h from E-168 to E inclusive, both por(h) and por(h-1) present and > 0.
5. Transient shadow row: first scored-set row of shadow_F with predTs >= S (no upper bound) and F flowState == rising; r = F's rawFinalCFS. Events with no such row would be counted in my extra `n_events_nopair` (0).
6. Offsets use (ema_L - ema_F)/r*100 literally, bins_L for arm L, bins_F for arm F, last bins row in file order with ts <= S (ISO string compare).
7. Branched check: "that row's cell and rawFinalCFS" read from the switch file row (flowBin, flowState, rawFinalCFS), S = switch date 00:00Z; formula taken literally as (ema_L(S)-ema_F(S))/r*100 (its sign is opposite to realized in the data; not interpreted). Extra metric `n_switch_rows_<date>`.
8. Lag check: value checks compare shadow value with the source value at the row's *SrcTs (mismatch if source is blank/missing or numbers differ, rel/abs tol 1e-9; both-blank skipped). Timestamp checks are counted only for rows where the source row at the nominal lag exists and is non-blank for that column (counts in `lag_ts_rows_<name>_<arm>`). Names: `lag_mismatch_<porQ|efStage|gooseQ|lfQ>` and `lag_mismatch_ts_<por|ef|goose|lf>` are F+L combined; `_F`/`_L` suffix variants are per arm. `lag_rows` = predicted rows of F plus predicted rows of L (each file all predicted rows, not only pairs).
9. sens_age: blank ages would not count as exceeding (none are blank). Sensitivity runs print section 1 counts to stdout but only write section 5 metrics for affected_rising / affected_flood.
10. Extras beyond spec: `boot_skipped` per population, `n_events_nopair`, per-arm lag rows. `metrics_python.csv` holds all numerics; the predTs strings are in the text file.
11. Divisions: `affected` rawFinalCFS ratio uses L as denominator, per spec. 1/0 booleans read as strings "1"/"0".

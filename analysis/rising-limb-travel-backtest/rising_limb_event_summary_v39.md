# Event-list summary (v39)

Data: hourly_backtest_data_v39.csv (130416 rows, 2011-12-01 05:00 .. 2026-11-09 23:00)
Events file: rising_limb_events_python_v39.csv  sha256 978c6c2f98a522ad98ff54cd3f172df534ed2a4c552a29490739ba0f5d7cac44

- Onsets: 87 (GATE 34, STRATUM 20, below 8,000 33)
- Merges: 1; events after merge: 53 (GATE 34, STRATUM 19)
- GATE: 34 events; flagged X0 2, X1 10, X2 4, X3 1, X4 0 (overlapping); sequential remaining after X0/X1/X2/X3: 32/22/21/21; KEPT 21
- STRATUM: 19 events; flagged X0 1, X1 3, X2 1, X3 1, X4 0 (overlapping); sequential remaining after X0/X1/X2/X3: 18/15/15/15; KEPT 15
- October 2026 event(s) containing 2026-10-14T12:00Z: [{"event_id": 53, "class": "GATE", "t0": "2026-10-12 02:00", "tp": "2026-10-14 15:00", "tend": "2026-10-19 15:00", "peak": 24300.0, "excluded_by": [], "kept": 1, "oct_flag": 1}]
- GATE kept: 21; GATE kept non-October: 20; floor 15; holdout size 4
- VERDICT: PROCEED

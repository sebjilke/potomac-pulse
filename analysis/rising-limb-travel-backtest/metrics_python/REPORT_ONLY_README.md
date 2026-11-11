# Report-only items, Python analyst (`rising_limb_report_only_python.csv`)

Provenance: this text was returned by the blind Python metrics analyst on 2026-11-11. The analyst's session could not write the file, so the orchestrator saved it on 2026-11-11 with the owner's approval ("save the readme"). It describes columns only and contains no result.

The file has columns `run, item, arm, group, stat, key, value`. It covers all four runs, applies the same tick rules as the gate (including the D-8 override), and uses the same units as the gate file. `key` holds the event_id, year or flow bin where stated. Nothing in this file decides the gate.

- **STRATUM_RL:** the RL metrics (n_events, n_ticks, mae_arm, mae_base, gain, improved) over the 15 kept STRATUM events.
- **LEAD_RL:** GATE events split into LF-led (raw PoR at stamp t0 < 50 % of raw LF at stamp t0), PoR-led and unknown. Gives event_ids plus the same RL metrics.
- **SEASON_RL:** GATE events grouped by the t0 month into DJF, MAM, JJA and SON.
- **PEAK_RL:** GATE events grouped by event_peak_lf, 12k to 25k versus 25k and above.
- **TRAVEL**, per GATE event:
  - Observed lag: the lag of 0 to 48 h that maximises the Pearson correlation between LF first differences over stamps [t0-12 h, t0+36 h] and PoR first differences shifted back by the lag. Raw stamps, at least 10 pairs; observed_lag_h, observed_corr, n_pairs.
  - Modelled travel: per arm, the mean of travel_por_gf + travel_gf_lf over the event's scored RL ticks.
- **CREST_B**, per GATE event: the PoR crest is the first argmax of raw PoR over [t0-12 h, tp]. Scored ticks run from the crest + 2 h to tp. Gives n_ticks, the number of ticks where B is inactive, and arm B's MAE against base.
- **BRIEF_WINDOW:** the literal window [t0, t0+24 h], RL metrics.
- **EVENT_EQUAL:** two forms, for all events and without October: the mean over events of (1 - MAE arm / MAE base), and 1 - mean MAE arm / mean MAE base.
- **CAP_BIND:** share of ticks with ceiling_applied, per arm including base, on RL ticks and on normal ticks.
- **YEAR_RL_MAE, YEAR_NORMAL_MAE, BIN_RL_MAE, BIN_NORMAL_MAE:** per-year and per-base-flow-bin MAE tables (e_unc on RL ticks, e_disp on normal ticks).
- **NORMAL_MONTH_BOOT:** the G4a relative change with a calendar-month block bootstrap, `default_rng(20261111).integers(0, M, size=(10000, M))`, re-seeded for each run, 2.5 and 97.5 percentiles. It is exempt from cross-language agreement (D-7 E3).

## Not computed

- Per-event PoR-onset timing: the plan does not define a PoR onset. The TRAVEL lag covers the timing question with the plan's own definition.
- Bin EMA trajectories for 12k to 25k rising: the tick files hold no bin state, and the snapshot file is closed to this analyst.
- Intervals for strata, LOEO and G4b cells: the plan names none.

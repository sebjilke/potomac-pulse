# ASSUMPTIONS (blind Python metrics analyst, step 4)

Readings taken where the plan / TICK_SCHEMA left a point open. Most literal reading chosen; none chosen by
looking at any result (no arm metric has been computed at the time of writing).

## Arm-independent rebuild (step 2)
- A1. Tick grid = D-5 H1: hourly 2011-12-01 05:00 to 2026-11-09 23:00 UTC. A "tick" after the last grid tick
  does not exist, so the LF view "at the first tick v >= t + h" is MISSING when v (or the search ticks v+1, v+2)
  lies beyond 2026-11-09 23:00. **This is the reading that produces the single mismatch reported in LOG.md**
  (tick 2026-11-09 12:00: the tick file reads the LF view at a tick 2026-11-10 00:00 outside the H1 grid).
  Ruled by the orchestrator as D-8 (literal reading stands): that tick is set to mask 0 in all four runs by an
  explicit override; G4a_edge / G4b_edge use the file mask as written (report-only).
- A2. LF view at tick v = LF stamp v-1 h, else v-2, v-3, v-4 h (H2: s, s-1, s-2, s-3 with s = v-1). PoR view =
  stamp t-2 h with the same 3 h carry. S2 view = stamp t (lag 0) for PoR and LF with 3 h carry; S3 = lag 1 h for
  both. Only PoR/LF existence of the S2/S3 view enters the S2/S3 mask check.
- A3. Rise rate for tau_ref = production `getPoRRiseRateFromHistory` (found in `netlify/functions/shared/model.js`,
  imported by `scheduled-update.js`) with `Date.now = t`, history = non-blank PoR stamps s' in [t-72 h, t-2 h]
  stamped s'+30 min (H3). The "6 h back" entry is therefore the latest s' <= t-7 h. `getFlowState` uses the
  history length (>= 8) and max(100, 2 % of current).
- A4. Horizon to tick offset = ceil(h - 1e-12) (TICK_SCHEMA section 5). Search v, v+1, v+2 (D-1 C2).
- A5. tau_ref compared with absolute tolerance 1e-9 h (JS and C `pow` may differ in the last ulp; observed max
  difference 1.8e-15 h). truth, truth_tick_utc, mask, mask_why, tau_converged compared exactly.
- A6. REC is rebuilt from the raw CSV (LF with runs of <= 3 missing stamps linearly filled, D-1 C1, stamps with no
  CSV row = missing, D-1 C3): stamps after tp up to tend, strictly before the first stamp after tp with filled LF >
  LF(tp); empty when tp = t0 + 239 h; later merge components' [t0_k - 12 h, tp_k] removed. Cross-checked against the
  event file's rec_start / rec_end / rec_n_stamps (0 differences) and then against the tick labels.
- A7. EW / normal use every row of the event file with `event_row == 1` (53 GATE + STRATUM events, kept or
  excluded). Onsets classed BELOW (< 8,000) are not events and do not create EW windows (plan section 3).
- A8. CHECK `n_tau_nonconverged_masked` = ticks with in_scoring == 1 AND mask == 1 (after the D-8 override) AND
  tau_converged == 0 (definition fixed by the orchestrator with D-8). `truth_mismatches` = count before the
  override; `truth_mismatches_after_override` = count after.

## Metric readings (step 3; written before any metric was computed, then applied)
- M1. "All events" = the 21 kept GATE-class events; "no Oct" = the 20 without the oct == 1 event. Holdout = event
  file `holdout == 1`, asserted equal to the last ceil(0.20 x 20) non-October GATE events by t0.
- M2. G5a/G5b/G7e/P3 denominators: scored (in_scoring, mask) ticks with an RL label of the subset's events and
  `base_rst == 'rising'` (H8). Non-converged = `stop == 'max_iter'`; lookup failure = stop in {no_hist, hist_lost}.
- M3. G7d set per arm comparison: scored RL ticks of GATE events with `truth_basehz` non-blank and the arm's
  `truth_own` non-blank (H6); the base row's `truth_own` is asserted equal to `truth_basehz` there.
- M4. G4b: cells keyed by the base-copy columns `base_flow_bin|base_flow_state` over scored normal ticks, cells
  with >= 200 ticks. pass = every such cell <= +5 %.
- M5. G3a bootstrap: per resample, hour-pooled bias = (sum over resampled events, with multiplicity, of
  100 x e_raw / truth over REC ticks) / (number of those ticks), per arm; statistic |bias(arm)| - |bias(base)|.
  Events with an empty REC (2025-05) contribute zero ticks.
- M6. G6a: in LOEO_all the dropped October event is judged at 0.10, every other drop at 0.15; LOEO_nooct at 0.10.
  Breadth on the remaining events, integer test improved x 100 >= 65 x n.
- M7. G7b MAPE and G3 bias divide by `truth` per tick (H14, section 4). G1/G6 gains are ratios of sums, which equal
  the MAE ratio because arm and base share the same ticks.
- M8. G4b `pass` requires at least one qualifying cell (otherwise 0); `worst_rel_change` is the largest cell value.
- M9. G6a rows: per dropped event (key) `gain, improved, n_events, threshold_gain, ok`; per subset `min_gain, pass`;
  overall `pass` with blank subset. ARM criteria: A = G1a G1b G2 G3a G3b G4a G4b G5b G6a G6b G7a-G7f;
  B and C = same with G5a instead of G5b. G4a_edge / G4b_edge never enter ARM.
- M10. Report-only readings (definitions in REPORT_ONLY_README.md): LF-led uses raw PoR and LF at stamp t0;
  season by t0 month (DJF/MAM/JJA/SON); peak class by event_peak_lf; observed travel lag via correlation of first
  differences on raw stamps; PoR crest window starts 2 h after the raw PoR crest; event-equal gain given in two
  forms; month-block bootstrap re-seeded per run.

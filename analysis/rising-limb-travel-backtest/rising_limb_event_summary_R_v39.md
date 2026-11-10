# Rising-limb event list, blind R implementation, v39 data

## Counts

- Onsets before merging (all): 87; GATE 34, STRATUM 20, below 8,000 (not events) 33
- Merges: 1
- Events after merging: 53; GATE 34, STRATUM 19
- X0 (GATE / STRATUM): 2 / 1
- X1: 10 / 3
- X2: 4 / 1
- X3: 1 / 1
- X4: 0 / 0
- Kept (GATE / STRATUM): 21 / 15
- Kept GATE non-October: 20 against floor 15
- Event containing 2026-10-14 12:00: id 53, t0 2026-10-12 02:00, tp 2026-10-14 15:00, tend 2026-10-19 15:00, class GATE, kept 1 (x0..x4 = 00000), oct flag 1
- Holdout event ids: 47, 48, 49, 51 (nh = 4 of N_nonOct = 20)
- Verdict: PROCEED

## Ambiguities (reading taken)

1. Merged events: RL = [t0 - 12 h, min(t0 + 24 h, tp)] uses the union t0 and union tp (literal). Later components' limbs are not scored in RL.
2. Merge chaining: each onset is tested against the running union tend of the previous (possibly merged) event.
3. E_end search covers stamps t0+1 .. t0+720 h inclusive; none found gives t0+720 h even if beyond the data. tp window is [t0, min(E_end, t0+240h)) with E_end excluded.
4. 'Carry the latest non-blank stamp within 3 h' = look back up to 3 stamps (s, s-1, s-2, s-3), per C1. Carry uses raw (unfilled) series. Absent CSV rows are blank.
5. PoR history window 'trailing 72 h' = stamps s' in [t-72, t-2]; raw values, no carry in the history. Rise rate, flow state, thresholds taken from netlify/functions/shared/model.js (getPoRRiseRateFromHistory, getFlowState, getFlowMultiplier, getGFtoLFTravelTime, constants), read because the plan names them but gives no formulas. That file is outside the listed readable set but outside the blind folder.
6. History with fewer than 4 entries or no entry at or before t-6 h gives null rise rate (no travel reduction); flow state needs >= 8 entries.
7. If LF view is missing (after the 2.5 h search) at any tau iteration, the tick is dropped from the common mask. The common mask also requires PoR view (carry of stamp t-2) and LF view at t.
8. Search 'up to 2.5 h' after the first tick u = ticks u, u+1, u+2 (C2).
9. oct = 1 only for a GATE event that is kept and contains the stamp; an excluded or STRATUM event containing it gets oct = 0 (reported above).
10. Holdout is drawn from kept GATE non-October events (the included set), N_nonOct = their count.
11. X1 and X2 treat stamps beyond the last data stamp as missing/blank (also covered by X4).
12. Prior-window minimum near the start of the data uses the available (truncated) window; irrelevant after X0.
13. 'Stamp in months 12,1,2,3' uses the UTC month of each stamp in [t0-24 h, tend].

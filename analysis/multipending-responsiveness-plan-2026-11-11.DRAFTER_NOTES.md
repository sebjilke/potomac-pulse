# A6 plan, drafter notes (2026-11-11)

Returned by the plan drafter with DRAFT v1. Not part of the plan.

### Decisions the owner must make (my recommendation in brackets)

1. **Run stage 1 at all?** [Yes. It is cheap and settles the open question. Expect FAIL.]
2. **Form of R1.** The brief's version is a median delay reduction of at least 8 h; mine is a mechanism check (median > 0 h and at least 3 times the event-created validations). [Mine. The 8-h version is roughly a coin flip on the slot's phase and says nothing about value.]
3. **R2 threshold for the displayed rising-limb gain.** [Keep 5 percent with CI lower bound > 0, but judged on the displayed value.]
4. **Normal-hours bar: N1 at +1 percent point; N2 as the brief's rule plus a hard +5 percent cap; N3 at +2 percent on the last 20 percent of time.** [Accept. The brief's N2 alone would have passed June's pattern.]
5. **Unsafe-direction rows S1 and S2 (-15 percent definition, +0.5 pp margin).** [Accept.]
6. **Coverage rows C1 to C3 (relative form, 2 pp).** [Accept. A fixed 90 ± 4 on event windows would fail both modes.]
7. **Stage-2 trigger and variant (rate >= 1 percent per hour, 4 rows, 3 h spacing).** [Accept as written, or drop stage 2 entirely. No tuning in either case.]
8. **If stage 1 passes narrowly: build or not.** [Do not build on a pass that relies on rows within 1 point of a threshold. Ask for a written risk review first.]
9. **Live check after any ship (shadow single-slot bins).** [Yes, if anything ships.]
10. **Confirm the "not to be tested" list (no multi plus arm A, no alpha study, on this record).** [Confirm.]

### Points I could not establish

- The real Netlify time limit for the scheduled function (30 s is the orchestrator's figure; it is not in the code) and typical Supabase round-trip latency.
- Whether the harness `lf_view` column is exactly the `q` used by the validation LF guard. I assume so; reconstruction check A7 would catch a difference.
- Exact counts of scored RL, REC and normal ticks and of month blocks (about 780 RL ticks is my estimate).
- How often rise mode (rate >= 1 percent per hour) fires in calm weather. It can be computed from PoR inputs alone without any truth, if the owner wants that before freezing.
- Which validation cadence the LF-residual advisory's thresholds were backtested on.
- Whether October 2026 is event id 53. Inferred from D-9; the plan uses `oct == 1` instead.
- Whether `analyze-stage-errors.js` or other code reads pending rows beyond what I found by searching for `gf_prediction`.
- What the v38 and CI v36.1 single/multi residual files show. Deliberately not opened.

### Critical files for implementation

- /Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/TICK_SCHEMA.md
- /Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/rising_limb_harness.mjs (ArmChain, MultiChain; stage-2 extension point)
- /Users/sebjilke/Desktop/PotomacPulse/analysis/rising-limb-travel-backtest/rising_limb_events_python_v39.csv
- /Users/sebjilke/Desktop/PotomacPulse/netlify/functions/scheduled-update.js (validatePendingPredictions, storePrediction, handler order)
- /Users/sebjilke/Desktop/PotomacPulse/netlify/functions/shared/ci-table.js and /Users/sebjilke/Desktop/PotomacPulse/netlify/functions/shared/model.js (bandFor, updateCorrectionBin, classifyOutlier, isExistingPredictionReplaceable)

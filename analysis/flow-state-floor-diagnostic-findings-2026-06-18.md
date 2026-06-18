# Flow-state floor — Step-1 leverage diagnostic: FINDINGS

**Date:** 2026-06-18 · **Spec:** `flow-state-floor-diagnostic-spec-2026-06-18.md` · read-only, no model change.
**Verification:** blind Python + R agree **exactly** (≪0.01); both replicate `getFlowState`
(`shared/model.js:173-199`) and self-spot-checked; the spec-auditor independently reproduced the same
numbers (three concordant computations). Data: `hourly_backtest_data_v361.csv` (124,064 classifiable
hours) + `ci_residuals_v361_multi.csv` (GF-keyed bins).

## Q1 — does the floor bite? YES.
- Floor-masked directionality (Rule A=steady but no-floor Rule B=rising/falling): **17.65%** of low-flow
  hours (`por<6000`); **20.65%** in the binding sub-band (`por<5000`). Split: masked-rising 7.4%,
  masked-falling 10.2%.
- Low flow is **49.5%** of all classifiable hours — the dominant operating regime, not a corner.
- (Caveat: the no-floor Rule B's directional labels at `|change|<100` are exactly the sub-threshold
  flips the v35.0 floor was added to suppress — so "masked" ≠ "all real signal"; some is gauge noise.)

## Q2 — do the low-flow states carry different corrections? MOSTLY NO (one marginal bin).
Mean RAW residual (what the learn-on-raw EMA converges to), GF-keyed bins:

| bin | rising | steady | falling | max|state−steady| | verdict (>100 & >SE & n≥30) |
|-----|--------|--------|---------|-------------------|------------------------------|
| 0-3000   | 279.2 (n2523) | 314.9 (n11833) | 255.0 (n3213) | **59.9 cfs** | **FAIL** (under 100) |
| 3000-6000| 416.9 (n5199) | 316.2 (n14259) | 229.1 (n8019) | **100.7 cfs** | **PASS, razor-thin** (0.67 over) |

SEs are 1.7–5.3 cfs (tight). So 0-3000's correction is ~state-independent (masking recessions there is
**harmless**); 3000-6000 has a real monotone gradient (rising > steady > falling), but the floor only
binds below 5,000 so it touches only the lower part of that bin, and the clear is marginal.

## Verdict: LOW / marginal-concentrated leverage
The floor masks a lot of low-flow directionality, but downstream it **barely matters**: the lowest bin
gains nothing (states don't differ), and the only bin with a real state gradient (3000-6000) grazes the
threshold by 0.67 cfs. A broad flow-state-classifier change is a **MAJOR** (re-keys all EMA learning →
bin reset, client/server parity, and a real false-flip regression risk — v35.0 already rejected
`max(50, 0.5%)` for minting noise labels). The expected accuracy gain is small and concentrated in part
of one bin.

**Recommendation:** treat 0a like the travel-time refit — **close as low-leverage**, OR (if the
3000-6000 signal is worth chasing) attempt only a *narrow* floor reduction in the 3000-6000 band, gated
by the same prequential backtest and explicitly checking that false-flips don't eat the gain. Even the
narrow option is marginal and may not survive the gate. **User decision required** (parent methodology
plan §5).

Outputs: `flow_state_floor_diag_python.{py,csv}`, `flow_state_floor_diag_R.{R,csv}`.

# Flow-state floor — Step-1 leverage diagnostic (spec)

**Date:** 2026-06-18 · **Parent:** `analysis/flow-state-floor-methodology-2026-06-18.md` (Tier 0 #0a).
**Status:** SPEC — read-only diagnostic, **no model change**. Decides whether 0a has enough leverage to
justify a MAJOR fix, or should be closed as low-leverage (like the travel-time refit).

## Question

The live classifier (`getFlowState`, `shared/model.js:173`) uses
`threshold = max(100 cfs, currentCFS × 0.02)` over a 6h lookback. The 100-cfs floor **binds whenever
PoR < 5,000 cfs**. Two things must BOTH be true for 0a to be worth doing:

- **Q1 (does the floor bite?)** At low flow, how often does the floor flip a reading that a relative-only
  rule would call rising/falling into **steady**? If rarely, 0a is moot.
- **Q2 (does mis-binning cost accuracy?)** Do the low-flow **falling/rising** correction bins differ
  materially from the **steady** bin? If the three low-flow states carry ~the same correction,
  re-classifying recessions changes nothing downstream → low leverage regardless of Q1.

Leverage is real only if Q1 (floor bites often) AND Q2 (states differ) are both yes.

## Data

`analysis/hourly_backtest_data_v361.csv` (126,917 hourly rows, 2011–2026; generator
`fetch_hourly_backtest_data_v361.py`). Columns used: `timestamp` (UTC), `por_now` (PoR discharge, cfs),
`lf_discharge` (LF actual, the learning target). No network; pure replay.

> NOTE the flow-STATE in the nowcast is computed on the **PoR** series (`getPoRRiseRateFromHistory`),
> while the flow-BIN is `getFlowBin(rawFinalUnclipped)` (GF estimate). The diagnostic classifies on the
> PoR series (`por_now`) to match the live state input. Auditor: confirm this is the correct series.

## Method (replicated independently in Python AND R, results-blind)

For each hour `t` (with ≥6h of prior history):
1. `current = por_now[t]`; `past = por_now` at the most recent row with `timestamp ≤ t − 6h` (exact live
   semantics — last reading at-or-before the 6h mark, not interpolated).
2. `change = current − past`; classify under each rule:
   - **A — live:** `threshold = max(100, current×0.02)`.
   - **B — relative-only (no floor):** `threshold = current×0.02`.
   - (Candidates C/D from the parent plan are NOT run here — this is leverage-only.)
3. Tag the flow bin from `current` (0-3000, 3000-6000, …).

**Q1 metrics** (focus on PoR < 6,000 — the 0-3000 + 3000-6000 bins):
- Fraction of low-flow hours where A says `steady` but B says `rising`/`falling` ("floor-masked"
  directionality). Split rising vs falling.
- Of sustained **recession segments** at low flow (≥6 consecutive hours of monotone PoR decline),
  fraction of hours A classifies `steady`.
- Overall state distribution by flow bin under A vs B.

**Q2 metric** (prequential, reuses the existing harness, NOT a new model):
- Run `analysis/ci_backtest_harness.mjs` (real `makeGFPrediction`, learn-on-raw EMA) and read out the
  **converged low-flow bin corrections** for `0-3000` and `3000-6000` × {rising, steady, falling}: report
  each bin's correction (cfs) and observation count. Leverage exists only if falling/rising differ from
  steady by more than the noise (and have enough obs to be real). This is a read-out of existing
  behavior, not a model change.

## Verification (CLAUDE.md analysis protocol)
- **Blind dual-language:** a Python subagent and an R subagent implement Q1 independently from this spec
  (not from each other), each writing `flow_state_floor_diag_{python,R}.csv`. The reported fractions must
  agree **< 0.01** (fail-fast on divergence). Q2 (the Node harness read-out) is single-source but its
  numbers are spot-checkable.
- **Third-agent audit:** a separate agent verifies cross-language agreement, confirms the PoR-series
  choice + the exact at-or-before-6h selection match the live `getFlowState`, and spot-checks ≥5 hours by
  hand against `por_now`.
- **Provenance:** outputs to `/analysis/` with the generating scripts committed; the CSV is gitignored
  but regenerable.

## Decision rule (pre-registered, sharpened per audit)

The audit's read-only replication shows Q1 ≈ 17.7% (floor bites hard; PoR<5,000 ≈ 42% of rows), so **Q1
is effectively a sanity floor that will pass** — the real decision is **Q2, per bin**:

- **Q1 sanity floor:** floor-masked low-flow directionality ≥ 5% (expected to pass). If it somehow fails,
  close immediately.
- **Q2 (decisive, per-bin, pre-registered):** **proceed** only if, for **≥1** of {0-3000, 3000-6000},
  `max|state-correction − steady-correction|` within that bin **> 100 cfs** AND **> that bin's standard
  error** AND the differing directional state has **≥30 obs**. Evaluate each bin separately (do NOT pool).
- **Close 0a as low-leverage** if no low-flow bin clears the Q2 bar. Document and stop — mirror the
  travel-time-refit outcome.
- If exactly one bin clears (the audit's preview: 3000-6000 likely yes, 0-3000 likely no), the finding is
  **"partial, concentrated leverage"** — report it as such and let the user decide whether a fix targeting
  only the 3000-6000 floor band is worth a MAJOR change.

## Audit resolutions (2026-06-18)

Independent methodology audit verdict: SOUND core, 3 MUST-FIX. Resolutions:

- **MUST-FIX 1 (bin-keying) — ACCEPTED.** Q1's headline floor-bite % is a property of the **PoR state
  classifier** and is bin-agnostic — that number stands. Any per-flow-bin breakdown in Q1 is explicitly a
  **PoR-keyed proxy** (`getFlowBin(por_now)`), NOT the live `getFlowBin(rawFinalUnclipped)` (~11.7% of
  rows differ), and is **not** aligned 1:1 against Q2. **Q2 uses the real GF-keyed `flowBin`** already
  stored in `ci_residuals_v361_multi.csv` (produced by the real `makeGFPrediction`), so Q2's bins are
  correct by construction. Labeled accordingly.
- **MUST-FIX 2 (Q2 bar + dual-source) — ACCEPTED.** Bar sharpened above (per-bin, >100 cfs, >SE, ≥30
  obs). Q2 is now **dual-sourced**: both the Python and the R agent independently `groupby (flowBin,
  flowState)` on `ci_residuals_v361_multi.csv` and report mean raw residual + SE + count per low-flow
  cell; must agree <0.01. (No model re-run — read-out of the existing residual log.)
- **MUST-FIX 3 (classifier guards) — ACCEPTED.** Both implementers MUST replicate exactly:
  `history.length < 8 → 'steady'`; `no row with timestamp ≤ t−6h → 'steady'`; **time-based** at-or-before
  pick (NOT index `t−6`; the data has 262 non-1h gaps up to 49h); drop rows with blank `por_now`. Use
  `analysis/flow_state_step1.py` (already vetted) as the reference for the at-or-before selection.
- **NICE-TO-HAVE — ACCEPTED:** report Q1 floor-bite **both raw and ice-filtered** (live learning
  hard-skips ice); add a **false-flip** companion (how often the no-floor Rule B mints rising/falling on
  sub-threshold noise — the v35.0 reason the floor exists); fix row-count wording (**124,071** non-blank
  `por_now` rows of 126,916 data rows); state the live-15min vs replay-hourly density caveat (bounded,
  shared `past` pick → floor-bite *differential* robust).

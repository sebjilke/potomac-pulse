# Narrow flow-state floor fix — candidate analysis plan (Tier 0 #0a, step 2)

**Date:** 2026-06-18 · **Class:** MAJOR (changes the estimate; re-keys EMA learning) · **Status:** PLAN —
awaiting (a) user methodology confirmation and (b) independent-auditor sign-off BEFORE any A/B run or code.

## What the diagnostic established (inputs to this plan)
- Floor (`max(100, q×0.02)`, binds at PoR<5,000) masks 17.7% of low-flow hours into "steady".
- Downstream that matters in **only the 3000-6000 bin** (rising +417 / steady +316 / falling +229 cfs raw;
  ~100 cfs gradient). **0-3000 is state-independent** (60 cfs spread) — masking there is harmless, and
  loosening the floor there only risks **false-flips** on gauge noise (the v35.0 rejection of `max(50,0.5%)`).
- So the fix must **capture 3000-6000 directionality WITHOUT minting noise labels in 0-3000**, and must
  leave the high-flow regime (≥6,000, where 2% already dominates) exactly unchanged.

## Target & invariants
- **Change only where the floor both binds and matters:** PoR roughly **3,000–5,000 cfs**.
- **Hard invariants (gate fails if violated):**
  - High-flow bins (12-25k, 25-50k, 50k+) corrections **byte-identical** to baseline (the floor never
    binds there; any change = a bug).
  - 0-3000 must not regress (no net accuracy loss from false-flips).
  - Client `getFlowState` ↔ server `getFlowState` stay byte-identical (parity test).

## Candidates (A/B arms vs the live baseline)
All keep the 6h lookback and the `q×0.02` relative term; they differ only in the absolute floor.

| id | rule (threshold for |Δ6h|) | rationale | risk |
|----|----------------------------|-----------|------|
| **BASE** | `max(100, q×0.02)` | live v35.0 | — |
| **C1 — band relative-only** | `q<3000`: `max(100, q×0.02)`; `3000≤q<6000`: `q×0.02`; `q≥6000`: `q×0.02` | drop the floor exactly in the masked band, keep it below 3000 | false-flips in 3-5k |
| **C2 — band lowered floor** | `q<3000`: `max(100,…)`; `3000≤q<6000`: `max(50, q×0.02)` | gentler than C1 | weaker capture |
| **C3 — continuous taper** | `floor(q) = clamp(q×0.02, 60, 100)` ramped so floor=60 at 3,000 → 100 at 6,000; `threshold=max(floor(q), q×0.02)` | no band discontinuity; smooth | more params to justify |

(Final functional forms may be refined by the auditor; the design space is "lower the floor in 3-5k,
preserve it <3,000 and ≥6,000".)

## Evaluation (prequential, real model)
- Harness: `analysis/ci_backtest_harness.mjs` — replay real `makeGFPrediction` over the 14-yr hourly
  data, learn-on-raw EMA, **one arm per candidate** (swap only `getFlowState`'s floor). Classification on
  PoR, binning on GF-final (exactly as production) — so the PoR-vs-GF indirection is handled correctly.
- **Primary metric:** per-(GF flowBin × flowState) and pooled **corrected-residual** MAE/RMSE/median|err|,
  prequential. Bins of interest: 3000-6000 (must improve) and 0-3000 (must not regress).
- **False-flip guard (pre-registered):** count how many obs each candidate moves from steady→directional
  in 0-3000 and 3000-6000, and the net corrected-residual change attributable to those moved obs. A
  candidate that improves 3000-6000 but degrades 0-3000 (or pooled) fails.
- **Blind dual-language:** accept/reject metrics computed independently in Python AND R from the arm
  residual logs (agree <0.01); fail-fast on divergence; third-agent audit with ≥5 live-USGS spot-checks.

## Pre-registered ACCEPT gate (all must hold for the winning candidate)
1. **3000-6000 corrected MAE improves** by a margin that beats noise (target ≥ ~1.0%, and the bin's
   median|err| not worse).
2. **No bin regresses > +2% median** (the C45 gate rule) — especially 0-3000.
3. **Pooled corrected MAE/RMSE ≤ baseline** (net non-negative).
4. **High-flow bins byte-identical** to baseline.
5. If no candidate clears all five → **REJECT**, close 0a as low-leverage (the diagnostic already warned
   the 3000-6000 signal is razor-thin, so REJECT is a live outcome).

## If a candidate PASSES (step 4, separate)
Implement in `getFlowState` (shared `shared-model.js` ↔ `shared/model.js`, parity-tested), MAJOR version
bump, decide on EMA bin reset (re-keying changes which bins learn → likely a low-flow bin reset, like
v35.0), re-baseline characterization snapshots deliberately, plan→audit→push. NOT in scope until the gate
passes.

## Decision requested from user
Confirm: (a) the candidate set, (b) the ACCEPT gate thresholds, (c) that a REJECT (close 0a) is an
acceptable outcome of the spend. Then auditor sign-off → run.

---

## REVISED RUN SPEC (post-audit, user-approved "proceed + fold in findings") — 2026-06-18

Independent auditor verdict: PROCEED ONLY AFTER MUST-FIX (geometry error + unverifiable gate). User
pre-approved running after folding the findings in. Resolutions (all 5 MUST-FIX **ACCEPTED**):

- **MF1 (band geometry) — ACCEPTED.** The signal is the GF-final 3000-6000 bin, fed by **PoR ≈ 2,700–5,375**
  (tributary uplift ~11.6%, EF≈0 below 6k); the nominal "PoR 3,000–5,000" missed the bin's lower edge.
  The candidate band is re-derived from the **GF-bin-implied PoR range**, starting the taper at PoR 2,700.
- **MF5 + MF2 (single, unambiguous, continuous candidate) — ACCEPTED.** Drop C1/C2 (band-edge
  discontinuities at q=3,000 are themselves artifact sources). Run **one** candidate:
  **C3′ (continuous taper):** `threshold(q) = max(q×0.02, floorFn(q))`,
  `floorFn(q) = clamp(100 − 40·(q − 2700)/2000, 60, 100)` — i.e. floor = 100 at PoR ≤2,700 (baseline,
  protects the state-independent deep-low-flow / no new 0-3000 false-flips), ramps **continuously**
  100→60 over PoR 2,700→4,700, then 60 above (where `q×0.02 ≥ 94` already dominates, so the floor is
  inert). No band-edge step anywhere; baseline-identical at PoR ≤2,700 and (effectively) ≥4,700.
- **MF2/MF3 (gate noise-protection + cell attribution) — ACCEPTED.** Replace the bare "≥1% MAE" primary
  with: **block-bootstrap CI** (blocks = contiguous-hour runs, to respect autocorrelation) on the
  **3000-6000 corrected-MAE delta**, accept only if the CI **excludes 0** in the improving direction. The
  improvement must be **attributable to the rising cell** (the only cell that cleared the diagnostic bar;
  falling-vs-steady = −87 cfs, FAILED it) — report the rising-cell corrected residual change explicitly.
  The "<0.01 Python/R agreement" is a reproducibility check, NOT the noise band.
- **MF4 (invariants) — ACCEPTED.** Hard-identical bins are **≥12,000** (not "high-flow"). **6000-12000 is
  expectedly perturbed** via the adjacent-bin fallback (`shared/model.js:270-277`) and the C45 ±12%
  interpolation around 6,000 (`:314-329`) — it is subject to the no-regress (≤+2% median) rule, not the
  identity rule. Add a **total classified-obs conservation** check (per-arm Σcount identical across
  bins/states; only state *assignment* may move).
- **False-flip guard (NICE-TO-HAVE) — ACCEPTED:** beyond net-residual attribution, add (i)
  sign-correctness of newly-flipped steady→directional labels (does PoR direction persist / does the LF
  outcome confirm?), and (ii) flip counts on the diagnostic's flat vs sustained-recession segments (the
  v35.0 noise mode). A candidate that adds many wrong-signed near-zero-residual labels must not pass.
- **Framing — ACCEPTED:** this is a **capped confirmation run, expected REJECT** (the diagnostic's single
  PASS cleared by 0.67 cfs; within-cell noise 2–3.6× the signal; reclassifying marginal obs into the
  rising cell can *dilute* it 417→~400 — the LF-ground-truth-bias pattern). Spend cap: **one** harness
  A/B (baseline vs C3′) + the blind dual-language readout. If the rising-cell bootstrap CI doesn't
  exclude 0, REJECT and close 0a.

**Final ACCEPT gate (C3′ must satisfy ALL):** (1) 3000-6000 corrected-MAE delta CI excludes 0 (improving),
attributable to the rising cell; (2) no bin regresses > +2% median (esp. 0-3000 and 6000-12000); (3)
pooled corrected MAE/RMSE ≤ baseline; (4) bins ≥12,000 byte-identical; (5) total-obs conservation holds.
Else REJECT → close 0a.

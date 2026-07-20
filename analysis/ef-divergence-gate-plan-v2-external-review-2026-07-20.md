# External Referee Review — EF Divergence Gate Plan v2

**Date:** 2026-07-20 · **Repo state:** 98cdd75 (v37.12) · **Document reviewed:**
`ef-divergence-gate-plan-v2-2026-07-20.md` (with `…-plan-2026-07-20.md` §7 as audit trail)

**Verdict: PROCEED after amendments. No fatal methodological flaw.** The design is unusually
disciplined (pre-registered gate, LOEO, common mask, fail-closed activation, conservative-cell
selection). Three issues must be fixed **before the replay runs** because they are
pre-registration-integrity issues (E1–E3); the rest are strengthening recommendations and minor
specification gaps. §10 questions answered at the end.

## Disclosure & method

This review was run in-repo by a session that had read `.claude/HANDOFF.md` (not a fully cold
read — the user directed this explicitly). Mitigation: no load-bearing claim was trusted from
context; every checkable claim was re-verified against code, the frozen dataset, or the live
database. Claims verified:

| Plan claim | Verified against | Result |
|---|---|---|
| Logistic weight `0.40/(1+exp(−5(ln f − ln 10⁴)))`, 0 below 1,000 cfs, self-referential on porEst | `shared/model.js:117-123`, `scheduled-update.js:838` | ✓ exact |
| `EF_DISCREPANCY_MAX = 0.50`, skip on both runtimes | `constants.js:135`, `great-falls.js:483`, `scheduled-update.js:842-847` | ✓ |
| EF power law 126·s^2.46 / 160·s^2.36 cold ≤10 °C; validity stage ∈ [2.5, 20], result ∈ (500, 500000) | `shared/model.js:97-105`, `scheduled-update.js:818-826` | ✓ |
| Server EF estimate bare; client applies frozen hysteresis (rising ×1.08 / falling ×0.92) | `scheduled-update.js:813-826` vs `edwards-ferry.js:160-166` | ✓ — see E6 |
| Hard flag: statistical outlier z > 3 (≥10 prior obs) | `scheduled-update.js:1108-1120`, harness `:123` | ✓ (so z=7.8/4.7 both hard) |
| v361 CSV: 126,916 rows, 2011-12-01→2026-06-16, 12 stated columns | `wc -l`, head/tail | ✓ exact |
| Hourly cron (→ "~5 samples / 5 h") | `netlify.toml` `0 */1 * * *` | ✓ |
| EF drains 96.3% of LF basin, ~16 mi upstream | `README.md:90` | ✓ |
| Tribs 7.1 / 3.0 / 0.66 / 0.87% | `constants.js:131`, `model.js:540-543` | ✓ |
| Low/mid bins carry positive learned bias; 6000-12000/rising negative ("helpful −1,350") | live `potomac_observations` (`gf_correction_bin`) | ✓ signs: 0-3000_steady +242, 3000-6000 +432…+441, 6000-12000_falling +231, 6000-12000_rising **−1,580** (n=4) |
| Harness: single mode = slot-occupied skip; hard-check replication | `ci_backtest_harness.mjs:17-18, 114-135, 229` | ✓ |
| "~583+ mi² ungauged intervening area" | not in repo; drainage-area arithmetic gives ~600 mi² | plausible, cite in census artifact (E2) |
| "+180…+356 cfs" bin values, "~8× slower" single-pending | production rows / derivation not in repo | consistent with live bins & travel arithmetic; accepted as reported |

---

## E1 (BLOCKER, pre-run) — Cold-water ineligibility cannot operate over 62% of the replay

`water_temp_c` is **100% missing 2011–2020 and 35% missing in 2021** in the frozen CSV (verified
by per-year count). The plan's rule — ineligible when cold model active or
"unknown-and-last-known-cold" — degenerates for 2011–2020: temp is *never* known, so by the
letter of the rule the gate is **eligible through nine winters** in exactly the ice/backwater
regime the guard exists for. Consequences: spurious winter activations contaminate normal-hours
cost (condition 2), duty cycle (condition 4), and the seasonal breakout is blind for those years.
Direction of bias is unknowable a priori (pessimistic if ice-divergence hours get boosted and
hurt; optimistic if they accidentally help), which is precisely why it must be pre-registered,
not patched after seeing results.

**Fix (pick one, write it into §1 before the run):**
(a) replay hours with missing temp in **Nov–Mar are gate-ineligible** (month proxy for the cold
guard; costs nothing on the census events, which are July–October); or
(b) impute missing temp from a month-of-year climatology built on 2022–2026 and apply the 10 °C
rule to the imputed value. I recommend (a): simpler, conservative, and mirrors production's
fail-closed philosophy. Event windows are unaffected either way (all warm-season).

## E2 (BLOCKER, pre-run) — The event-window census has no artifact

The §4 windows are the denominator of condition 1, and the repo rule is "every CSV has a
generating script" — but **no census script or output exists in `analysis/`** (checked). The
census currently lives only in a chat session. Two sub-issues:

1. **Reproducibility:** build `census_below_por_events.py` (daily-mean decomposition, ≥50%
   ungauged share of LF excess, PoR contribution <40%) + an events CSV as step 0 of the gate
   build, and confirm it reproduces the 6 historical windows *before* any replay. If it doesn't,
   reconcile and document — after freezing, windows cannot move.
2. **Uniformity:** the 2026 windows are not census-selected — they are "the failures." State
   whether each 2026 episode meets the census criterion (the script can just report their
   ungauged shares). Also tidy the ±2-day convention: 2026-07-09→12 is not "flagged day ±2"
   (07-08→12 would be), and 07-17→20 is truncated by dataset end — fine, but say so in the
   artifact rather than leaving the asymmetry silent.

## E3 (BLOCKER, pre-run) — Pre-registration is not yet numeric in seven places

Each of these is currently a word where the post-hoc analyst needs a number. Cheap to fix; the
gate is only as pre-registered as its vaguest clause:

1. **Condition 4 "meaningful harm"**: propose — 95% block-bootstrap CI of ΔMAE on normal
   `a > 0` hours (and separately `a > 0.5`) must exclude **+5% relative to C0's MAE on those
   same hours**.
2. **Bootstrap spec**: level (95%), iterations (10,000), block unit (episode for event metrics;
   calendar month for normal-hours metrics).
3. **Production-fidelity tolerance (§5)**: "approximately reproduce" → propose |replay − logged|
   ≤ max(5%, 150 cfs) at each of the three timestamps, plus same flow bin and same correction
   sign. Hourly-median vs instantaneous inputs make exact match impossible; say what counts.
4. **Condition 3 min-n**: bin×state cells with < 200 common-mask scored hours (per mode) are
   report-only — otherwise sparse cells (live bins today have n=1–4 in several states) fail or
   pass by noise.
5. **Conservative-cell order**: lexicographic — highest T_LO, then lowest W_CAP, then wider band
   (T_HI−T_LO = 0.25 over 0.15). Currently a two-key partial order with no tiebreak.
6. **C2 "within CIs of the best"**: define — C2's pooled event-window MAE point estimate falls
   inside the best C1-variant cell's 95% bootstrap CI AND C2 itself passes conditions 1–6.
7. **Recovery window**: "5–7 days" → pick one number (6 days). And **C1-freeze keying**: freeze
   should key off the **prediction-time `a` stamped on the pending row** (`efGateActivation`),
   not activation at validation time 6.5–11 h later — say so.

## E4 (STRONG) — The 2026 episodes are the hypothesis-generating data; fence them

Both motivating episodes sit inside the confirmatory event set. LOEO drops them one at a time,
never both. A cell could clear the 25% pooled bar substantially on the two events the mechanism
was reverse-engineered from. Add two cheap sub-conditions to condition 1:

- **1H (historical floor):** with *both* 2026 windows dropped, pooled event-window MAE still
  improves ≥ **15%** vs C0 on the 6 historical windows.
- **1B (breadth):** MAE improves (any margin) in ≥ **5 of 7** independent episodes.

This is the direct answer to the plan's own "n=2 enthusiasm" risk (§8) — currently that risk is
named but not mechanically defended against, because the n=2 sits inside the gate's numerator.

## E5 (STRONG) — Reformulate the mechanism as one convex combination (kills the only discontinuity)

As specced, weight and damping are already algebraically equivalent to
`estimate = (1−a)·[status-quo pipeline] + a·[boosted pipeline]`
(w = (1−a)·w_logistic + a·W_CAP; correction × (1−a)) — **except the skip**, which flips
discretely at `a = 0⁺`. When D̄ crosses T_LO with instantaneous discrepancy > 50%, the estimate
jumps from porEst (EF skipped) to a blend at w_logistic — up to ~10% of the estimate at
mid/high flows (w_logistic ≈ 0.10 at 8k cfs, 0.20 at the 10k midpoint; ≤1.4% below ~6k, so the
July episodes wouldn't have noticed, but a mid-flow flapping D̄ around T_LO will). Writing the mechanism as
the convex combination (skip lives inside the status-quo branch only) removes the discontinuity
with zero new parameters, makes `a = 0 ≡ C0` structural rather than emergent, and is easier to
parity-test. Same sweep, same cells.

## E6 (STRONG) — Client/server EF-estimate parity under boosted weight must be decided now

The plan makes D bare-power-law on both runtimes, but is silent on which EF estimate enters the
**blend**. Today: server blends bare (`scheduled-update.js:813-826`); the client blends
hysteresis-multiplied (×1.08/×0.92 frozen — but `loadEFHysteresis` merges **localStorage**, so
legacy browsers can carry drifted multipliers clamped to [0.8, 1.2]). At w ≤ 0.40 that is a
≤3.2–8% displayed-vs-validated gap; at W_CAP = 1.0 it becomes **up to 8–20% of the headline
number**, and the gate's evidence (server-path replay = bare) would not describe what users see.
Specify in §1/§7 now: while `a > 0`, the client ensemble uses the **bare** EF estimate
(hysteresis excluded), parity-tested — or strip hysteresis from the client blend path entirely
and confine it to the EF-only ice fallback. Decision affects nothing in the replay code but
determines what the replay is evidence *of*.

## E7 (STRONG) — Single-pending mode is production; give it quantitative teeth (Q3)

"No sign reversal of conditions 1–3 in single" is too weak and, for condition 3, ill-defined
(condition 3 is a threshold over ~18 sparse cells — what is its "sign"?). Production learns and
validates in single mode; multi mode is the statistical-power instrument. Proposed single-mode
requirements (replacing sign-reversal):

- **S1:** pooled event-window MAE improves ≥ **10%** (point estimate);
- **S2:** normal-hours MAE degrades ≤ 2% (same bar as multi);
- **S3:** no *flow bin* (aggregated across states, min-n 100) degrades > 10%; per-cell condition
  3 is report-only in single mode.

Keep multi as the full-battery primary. This preserves the plan's intent while making the
production-mode check falsifiable.

## E8 (RECOMMENDED) — Duty-cycle audit: add a flow-bin breakout and a drought note

Condition 4's breakout is by season and temp only. Add **by flow bin**. Reason: at the drought
edge the mechanism has a structural bias — EF validity floor (stage 2.5 ft) implies efEst ≳
1,200 cfs warm, while porEst can sit at 600–900 cfs, giving D ≈ 1.3–2.0 from rating-edge
extrapolation alone → chronic activation in the 0-3000 bin pushing estimates up ~W_CAP·70%.
The replay will price this only if the audit can see it. Separately: 5% of normal hours at
`a > 0.5` ≈ 18 days/year half-boosted on one stage-only gauge — consider 3% for the a>0.5 cap
(the selection rule already prefers conservative cells; this aligns the cap with it). Also
report duty at `a > 0.25` (the C1-freeze threshold) so freeze exposure is visible.

## E9 (RECOMMENDED) — Rating-drift sentinel in production (Q1's residual hole)

The backtest cannot protect against *future* EF rating drift (channel geometry change after a
flood; the power law is house-fit, USGS publishes no EF discharge to diff against). A slow +10%
drift sits below T_LO=1.10 as pure estimate bias and above it as chronic activation. Cheap
sentinel for §7: rolling 30-day median of `efEst / LF_actual` on gate-inactive normal hours —
alarm and **suspend the gate (fail-closed)** if it departs ±10% from its historical band; plus a
standing annual EF power-law refit check while the gate is live. Surfacing the 30-day duty cycle
in the learning UI covers the "quiet chronic activation" case.

## E10 (MINOR, batch) —

- **Dedup precedence (§3):** overlap 2026-06-14→16 — state that **v361 rows win**; freshly
  fetched rows append only at new timestamps (provisional revisions must not silently rewrite
  frozen provenance).
- **Temp staleness:** "unknown-and-last-known-cold" blocks, but unknown-and-last-known-*warm* is
  eligible indefinitely. Add a staleness cap (temp older than ~7 days ⇒ treat as unknown-cold in
  Nov–Mar, unknown-warm otherwise — mirrors E1's proxy).
- **Global-MAE arithmetic:** conditions 1+2 jointly permit global MAE to worsen slightly —
  with events ~0.7% of hours at ~6× normal MAE, a 25% event gain buys back ~1% of global MAE
  while the 2% normal-hours allowance can cost ~2%, netting ~1% worse globally.
  Likely intended — worst-case honesty over average polish — but say it, or add a global guard
  (≤1% degradation).
- **Root-cause #3 overstates the skip's role in these episodes:** at the two failures the
  discrepancy was ~24% and ~19.5% (inverting the logged weights 2.8%/0.1% gives porEst ≈ 5,960
  and ≈ 3,196; |efEst − porEst|/porEst = 23.8% and 19.5%) — **below** 0.50; the skip never fired. The binding failure
  both times was the weight (2.8% / 0.1%), which §0.2 correctly identifies. Keep the
  skip-disable (it binds in larger divergences), but reword #3 as prophylactic rather than
  evidenced.
- **Ceiling diagnostics:** report the 120%-LF ceiling bind-rate during gate-active hours
  (boosted estimates will meet it more often in sharp onsets; scoring is on the displayed value,
  so a binding ceiling is part of the arm's measured behavior — make it visible).
- **C0 replay accuracy ≠ historical production headline** (production excluded hard-flagged
  validations from accuracy; the common mask doesn't). One sentence in the gate report prevents
  a confusing cross-reference.
- **Per-window C0 MAE table:** report it (maturity gradient over 15 prequential years is real;
   2012's window is scored on ~7 months of learning). No gate change — LOEO already covers it.

---

## §10 answers

**Q1 — activation design sound?** Yes, with four caveats, all addressed above: the replay-side
temp hole (E1) is the largest actual soundness gap; the skip-disable discontinuity (E5) is the
only non-smooth seam; client-blend parity (E6) determines whether production matches the
validated evidence; and slow EF rating drift is the one failure mode the backtest structurally
cannot see — mitigate in production, not in the gate (E9). With E1/E5/E6/E9 adopted I find no
further exploitable mode: fail-closed on validity, one-sided, cold-ineligible, median-sustained
is a defensible detector.

**Q2 — thresholds right?** Magnitudes yes (25/2/5 are sane for this error structure), but
severity is currently *nominal* because condition 1 is a point estimate over a pooled set that
contains the two hypothesis-generating episodes. Adopt E4 (historical floor 15% + breadth 5-of-7)
and add a bootstrap-CI-excludes-0 requirement on the pooled event delta; then the numbers mean
what they claim. Duty-cycle cap: tighten a>0.5 to 3% (E8). Condition 3 needs the min-n rule
(E3.4) to be evaluable at all.

**Q3 — combination rule sufficient?** Not as written — "no sign reversal" is undefined for
condition 3 and toothless for 1–2. Single-pending should not be *primary* (it starves the
per-cell diagnostics), but it must carry quantitative requirements: adopt E7 (10% / 2% /
bin-level 10%). Multi-primary + quantified-single is the right compromise.

**Q4 — common mask?** No objection — it is the correct call, and the plan's own observation
that C0 hard-flagged its two worst hours (z = 7.8, 4.7 excluded from its own accuracy) is the
QED. Keep per-arm flag counts as diagnostics; add the C0-vs-production-headline caveat (E10).

**Q5 — is C2 the right simpler alternative?** C2 is fair but incomplete as the simplicity
comparator: it removes self-reference's *consequence* (low weight at low flow) without removing
self-reference. Add one 6-cell arm, **C2-max**: the existing logistic evaluated on
`max(porEst, efEst_bare)` with the same re-centered midpoints {3k, 5k} × W_MAX sweep. It is a
one-line, stateless, no-skip-change mechanism that de-self-referentializes directly (worked
example: at the 07-19 miss, midpoint-3k C2-max yields w ≈ 0.31–0.50 vs the shipped 0.1%).
Known cost — an EF glitch lifts its own weight (no median sustain), bounded by W_MAX and the
unchanged 50% skip; the false-activation audit prices it. If C2-max survives the gate within CIs
of C1, simplicity should win per the plan's own tie rule. Simpler-still options (pure display
honesty) are already the FAIL fallback, correctly.

## Bottom line

Adopt E1–E3 before the replay (they are what "pre-registered" means); fold E4–E9 into the spec
(all are cheap; none change the architecture); batch E10 at will. With those amendments this is
a shippable evaluation design, and — unusually for a plan reviewed at this stage — the failure
path (FAIL → display-honesty patch only) is as well-specified as the success path.

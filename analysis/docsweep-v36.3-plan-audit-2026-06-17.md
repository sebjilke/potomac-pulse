# Independent Audit — v36.3 Documentation-Accuracy Sweep Plan

**Auditor role:** Adversarial, independent (did not write the plan).
**Date:** 2026-06-17
**Plan reviewed:** `analysis/docsweep-v36.3-plan-2026-06-17.md`
**Frozen audit:** `analysis/science-review-2026-06-10.md`
**Method:** Every current→new mapping and tier classification checked against the live files by content (line numbers re-derived, not trusted). C40/C7/C5/C9 verified by executing the actual deployed arithmetic. `npm test` run (407 pass). Dead-code callers grepped across `src/`, `netlify/`, `index.html`, `test/`.

---

## Verdict summary

The plan is **substantially correct and well-scoped.** The three load-bearing code edits (C7, C9, C10) are behavior-preserving as claimed; I independently confirmed the C9 gate is currently always-pass, the C7 integer arithmetic is right (with one boundary nuance), and the two deleted/annotated functions have zero live callers. The C40 worked-example fix is not just cosmetic — the *current* Example 1 is internally impossible (claims a 79% stage-discharge flag at a stage where the curve yields −8%), and the new values restore both intended sub-checks. C5 and C38 numbers reproduce exactly.

The defects are concentrated in **completeness misses** (stale figures and stale comments the sweep leaves behind, creating new internal contradictions) and **two inaccurate replacement strings** (CLAUDE.md gauge-tier rewrite; a line-number drift). None of the code edits are mis-tiered.

**Counts:** 2 BLOCKER · 5 SHOULD-FIX · 4 NICE-TO-HAVE

---

## BLOCKERS

### B1 — CLAUDE.md L140 replacement is itself factually wrong (gauge_id tiers don't exist)
The plan replaces the false "Three gauge_id tiers: hard_flagged, soft_flagged, validated" with **"Two written tiers on flagged rows: hard_flagged, soft_flagged (validated predictions are deleted, not stored)."** This new text is *also* wrong. I grepped every `gauge_id:` literal write in `scheduled-update.js` and `sync-learning.js`:

- Predictions are written with `gauge_id: 'pending'` (scheduled-update.js:1391) and **deleted** on validation (scheduled-update.js:996–999, `.delete().eq('id', pred.id)`).
- Flag status is tracked as **metadata counters** in `gf_metadata` (`hardFlaggedValidations`, `softFlaggedValidations`, scheduled-update.js:1241/1248) — **not** as `gauge_id` row tiers.
- The literals `'hard_flagged'` / `'soft_flagged'` / `'validated'` are **never written anywhere** in the codebase. They appear only in: prose (tech-appendix L469/L475), the v33.0 CHANGELOG entry, and the dead reader `analyze-stage-errors.js:58` (`.eq('gauge_id','validated')`, querying a value nothing writes).

So "two written tiers on flagged rows" describes rows that do not exist. **Correct statement:** anomaly status is recorded only as counters in `gf_metadata`; pending prediction rows use `gauge_id: 'pending'` and are deleted on validation; there are no per-row flag tiers. This is the central C10 claim CLAUDE.md is supposed to fix — shipping a second wrong version of it defeats the purpose.

### B2 — Seven of eight stale "Client copy exists in index.html" comments are left in place (new contradiction)
The plan (§3.3) fixes the stale sync pointer at `shared/model.js:112` only. But `index.html` is now a 678-line thin loader with **no model code at all** (I grepped: `estimateLFFlowFromStage`, `4139`, `126 * Math.pow`, `estimateGreatFalls`, `TRAVEL_COEF` — zero hits in index.html). The real client copy lives in `src/model/shared-model.js` (confirmed: contains `estimateLFFlowFromStage` L144, `getFlowState` L205, travel constants).

`shared/model.js` carries **eight** "Client copy exists in index.html" SYNC WARNINGs: lines **3, 38, 64, 76, 91, 102, 112, 343.** After this sweep, line 112 will correctly point at `src/model/shared-model.js` while the other seven still say "Client copy exists in index.html" — a self-contradiction the edit *creates*, and exactly the C10 "stale sync pointer" defect the sweep exists to close. Fix all eight (or rewrite the file-level comment at L3 once and delete the per-block repeats). Tier D, but load-bearing-adjacent: these comments are the project's only in-code sync contract, and CLAUDE.md is simultaneously being rewritten to assert the src/↔server pairing.

---

## SHOULD-FIX

### S1 — CLAUDE.md version bump targets the wrong line (L138 vs actual L132)
Plan §4.4 says "L138 ver: `Current Model Parameters (v36.2)` → `(v36.3)`." The actual header is at **L132.** L138 is the Empirical-90%-CI bullet (unrelated). Implementer following the stated line number will edit the wrong line. (Line drift — the plan's other CLAUDE.md refs L96/L128/L140 are correct.)

### S2 — README L58 second version header not in the edit list
`README.md` carries the model version in **two** places: L6 (`**Current Version**: v36.2`) and **L58 (`## Current Model (v36.2)`).** Plan §4.2/§5 names the L6 header, the footer, and the version table, but not L58. Leaving L58 at v36.2 is an internal contradiction with the bumped L6/table. Add L58 to the edit list.

### S3 — C9 `correlationCount` is read in TWO return objects, but only the edwards-ferry.js source is being cleaned
The plan deletes `correlationCount: 16971` from `edwards-ferry.js:161–162` and changes the UI gate at `great-falls-ui.js:210`. Correct. But note the field is **consumed** at great-falls-ui.js:210 (`gfEstimate.efEstimate.correlationCount >= 10`) for the object returned by BOTH the main path (`great-falls.js:593`, `efEstimate: efEstimate`) and the ice-mode path (`great-falls.js:368`, same). After deleting the field and changing the gate to a plain `if (gfEstimate.efEstimate)`, both paths are handled — *provided the gate edit lands.* The risk is ordering: if the field is deleted but the gate edit is missed, the gate `efEstimate.correlationCount >= 10` becomes `undefined >= 10` = **false**, and the EF cross-check panel would **silently stop rendering in all cases.** The two edits must be atomic. Call this out as a coupling constraint in the implementation checklist (the plan's §6 mentions the gate risk but not the delete-without-gate failure mode).

### S4 — C7 plan justification mis-states the gap=2.0h boundary
Plan §3.1 prose: "(gap 2.0→1 missed, 3.0→2, 6.0→5)." I executed the new code: at **exactly gap=2.0h** the `gapHours > 2` test is false, so **0** missed runs are added and `consecutiveRuns` increments (`gapHours <= 2` true). The "2.0→1 missed" claim is wrong; the first value that yields 1 missed is gap>2.0 (e.g., 2.001). The *code* is correct and the boundary behavior is the right one (no false positive at a clean 2h gap); only the plan's worked example is mis-stated. Fix the prose so the re-audit and changelog don't propagate it. (3.0→2, 6.0→5 are correct.)

### S5 — `medianErrorPct` decision is sound but the verification step must actually run
Plan §3.2 keeps `constants.js:81 medianErrorPct: 6.3` and says to `grep medianErrorPct` once more for display consumers. I ran it: `edwards-ferry.js:157` copies it into the returned object, but the UI (`great-falls-ui.js:207–232`) renders only cfs/stage/icon — confirmed **no display consumer.** The `build-ef-correlation-advanced.js` hits are a separately-computed field, not this constant. So the decision holds. Flagging this as SHOULD-FIX only to ensure the implementer treats the grep as a gate, not a formality — and to record that I already confirmed it passes.

---

## NICE-TO-HAVE

### N1 — README L227 footer currently reads v36.0, not as the plan implies
Plan §4.2 L227 maps the footer to the v36.3 string. Current L227 is `*Last updated: 2026-06-16 (v36.0 ...)*`. The intent (rewrite to v36.3) is right; the mapping just didn't quote the real current value. Cosmetic.

### N2 — C5 surrounding prose mentions "flat 35% step function" — leave it, but confirm
The replaced §5.4 table (L267–274) sits above prose (L276) citing "4.6% improvement over the best alternative (flat 35% step function)." That sentence is about the horse-race winner, not the table values, so replacing the table body alone does not contradict it. No action needed; noted so the implementer doesn't over-edit.

### N3 — `analyze-stage-errors.js:58` deferral (Q3) is correct AND now extra-justified
I confirmed `.eq('gauge_id','validated')` queries a value that is **never written** anywhere in the repo — the query is inert (returns nothing). Deferring is safe. Stronger framing: this is the *same* root fact as B1 (no flag/validated gauge_id tiers exist), so when B1 is fixed, add a one-line note that analyze-stage-errors.js:58 is a known-dead reader pending the Q3 follow-up, to avoid a future reader "fixing" the docs back.

### N4 — tech-appendix L13 vs L38 reference points (verify, don't conflate)
Plan changes L13 PoR to "~34 river miles upstream" (of Great Falls) while existing L38 says PoR is "41 river miles upstream" (of Little Falls). These are different reference points (PoR→GF ≈34 vs PoR→LF =41) and are mutually consistent. The implementer must not "reconcile" them to the same number. Noted to prevent an over-eager edit.

---

## Detailed verification of the questioned items

### C9 UI-gate change — VERIFIED behavior-preserving
- `estimateGFFromEdwardsFerry()` (edwards-ferry.js:113) returns `null` at lines 115 (no stage), 120 (stage out of [minStage,maxStage]=[2.5,20.0]), and 146 (estimate <500 or >500000); otherwise returns a full object that **always** includes `correlationCount: 16971` (L162).
- `efEstimate` propagates unchanged into `gfEstimate.efEstimate` in both return paths (great-falls.js:368 ice-mode, 593 main). So **`gfEstimate.efEstimate` is null exactly when EF is unavailable** — the plan's claim is TRUE.
- `16971 >= 10` is **always true**, so the current gate `efEstimate && efEstimate.correlationCount >= 10` is **functionally identical to `efEstimate` alone** today. The change is behavior-preserving. **Confirmed: the gate is currently always-pass.**
- Removing the gate does **not** change when the panel renders. The only failure mode is the atomicity issue in S3.

### C40 worked examples — VERIFIED, and the current doc is provably wrong
Executed the deployed `estimateLFFlowFromStage` (shared/model.js:40) and EF power law (126·EF^2.46), against the real flag thresholds (scheduled-update.js:966–989):

| | LF cfs | stage | stage-discharge expected | disc | low-flow/high-stage (cfs<1500 & stage>2.45) | result |
|---|---|---|---|---|---|---|
| **Ex1 CURRENT (2.60 ft)** | 1,120 | 2.60 | **1,026** | **−8%** (NOT >35%, no HARD) | fires (2.60>2.45) → +2 | score **2**, not the doc's "4" — **doc is impossible** |
| **Ex1 NEW (2.83 ft)** | 1,120 | 2.83 | **2,000** | **+79%** (>35% → +2) | fires (1120<1500, 2.83>2.45) → +2 | score **4 HARD** ✓ |
| **Ex2 NEW EF (6.20 ft)** | 8,500 (LF @3.10) | EF 6.20 | EF est = **11,211** | **+32%** (>25% → softScore +2) | n/a (8500>1500) | **SOFT** ✓ |

- The **low-flow/high-stage sub-check still fires at 2.83 ft** (2.83 > 2.45) — the plan's specific claim. ✓
- Inverse for 11,200 cfs = (11200/126)^(1/2.46) = **6.197 ft ≈ 6.20** ✓; EF warm @3.50 = 2,746 (matches plan §1).
- Ex2's unchanged LF stage 3.10 ft does **not** trip the stage-discharge HARD check (expected 3,257 < actual 8,500 → negative disc), so no contradiction is created. ✓
- **The C40 fix is necessary, not cosmetic:** the current Example 1 attributes a 79% stage-discharge flag to a stage (2.60 ft) where the deployed curve produces −8%. A reader checking the code against the doc would conclude the code is broken.

### C7 missed-run math — VERIFIED (cadence confirmed hourly)
- `netlify.toml:36 schedule = "0 */1 * * *"` → hourly. ✓
- New code (executed): `gapHours>2` fires; `Math.floor(gapHours)-1` missed; `gapHours<=2` keeps the streak. At gap=2.0 → no fire, streak continues (correct, no boundary false-positive). 2.001→1, 3.0→2, 6.0→5. Integer arithmetic is correct for hourly cadence (N-hour gap ⇒ N−1 skipped runs). The old `floor(gap/2)−1` assumed 2h cadence and under-counted by ~2×.
- The `>2h` (vs `>1h`) jitter-headroom argument is sound: Netlify scheduled functions fire late; a healthy hourly gap can be ~1.1–1.5h, which `>2h` correctly does not flag. No boundary bug at 2.0h. **Only defect: the plan's prose example "2.0→1 missed" (see S4).**

### C10 deletions — VERIFIED zero live callers
- `computeGFHistoryFromPoR`: only its own definition (great-falls.js:207) and a CHANGELOG mention (v33.1). Not imported anywhere. **Safe to delete.**
- `getTravelTimeAwarePor`: only its own definition (great-falls.js:243). Not imported anywhere. **Annotate-not-delete is defensible** (it is the C22 forecast-fallback scaffolding; the science review explicitly lists wiring it OR deleting it as recommendation #9). See Q2.
- Neither function, nor `correlationCount`, is referenced by any test — deletion cannot break the suite.
- `npm test`: **407 pass** (matches plan baseline).

### C5 EF-weight table — VERIFIED
Computed deployed logistic (W=0.40, K=5.0, midpoint ln(10000)): 1,000→0.0%, 3,000→**0.1%**, 5,000→**1.2%**, 10,000→20.0%, 20,000→**38.8%**, 50,000→**40.0%**. Matches plan §1 exactly. Current doc table (3,000→1.8%, 5,000→3.5%, 20,000→36.5%, 50,000→39.8%) does NOT match the K=5 curve — the fix is justified.

### §8.1 travel numbers — VERIFIED
At 1,000 cfs (clamp): mult=2.608, PoR→GF=**50.6h**, T_total(PoR→LF)=67.6h. +6h forecast ⇒ PoR 44.6h ago (plan "~44"); +48h ⇒ PoR 2.6h ago (plan "~2"). Matches.

### index.html travel table — VERIFIED, selective fix is internally consistent
Computed (reach=41 mi, speed=41/T_total): 1,200→60.6h/0.68mph, 2,000→44.7h/0.92mph, 5,000→25.9h/1.58mph, 15,000→13.4h/3.05mph, 50,000→6.6h/6.25mph. The plan fixes only the two low-flow rows (→0.7mph/60hrs, 0.9mph/45hrs); the 5k/15k/50k rows already match the formula, so leaving them is correct — no contradiction created. index.html L248 "19–33 hrs" → "~5–50 hrs" is a genuine C6 residual the prior v36.2 sweep missed.

---

## Answers to the plan's Q1–Q4

**Q1 (C7 testability): Extract `computeRunHealth(gapHours, prev)` as a pure exported helper + unit test.** Recommended over worked-examples-only. Evidence: no existing test touches `updateRunHealth`/`missedRuns`/`consecutiveRuns`/`gapHours` (grepped `test/` — zero hits), so there is *no* regression guard, and the plan's own §3.1 prose already got the 2.0h boundary wrong (S4) — proof that humans mis-reason about this arithmetic. A 6-line pure helper + a table-driven test pinning {1.9→no-fire/streak, 2.0→no-fire/streak, 2.001→1, 3.0→2, 6.0→5} is cheap, raises the count past 407 (satisfying the gate), and is the only durable guard against a future "tidy-up" reintroducing the 2h assumption. The extraction is mechanical and does not change runtime behavior.

**Q2 (getTravelTimeAwarePor): Annotate as TODO(C22) — recommended, as the plan proposes.** It is live-uncalled but is the exact offset scaffolding the frozen review's recommendation #9 says to wire into the forecast PoR fallback (C22). Deleting forecloses that deferred work and would force a re-write. Keep it, add the `// TODO(C22): ...` annotation. Caveat: the annotation must be accurate — the function does iterate travel-time and walk PoR history, but applies **no tributary scaling**, which is the other half of what C22 needs; say so in the TODO so the next implementer isn't misled that it's complete. If the team would rather not carry dead exports, delete-with-CHANGELOG-note is acceptable but strictly worse here.

**Q3 (analyze-stage-errors.js dead reader): Defer — recommended, and now extra-justified.** I confirmed `.eq('gauge_id','validated')` queries a gauge_id value that is **never written anywhere in the repo** (same root fact as B1). The query is inert; removing it safely requires reading the whole function, which is out of this sweep's scope. Defer, but add a one-line code comment marking it known-dead so a future doc-reader doesn't "correct" the docs back toward a validated-tier that doesn't exist.

**Q4 (mis-classification + missed stale figures):**
- **No code edit is mis-tiered.** C7/C9/C10 are correctly Tier C; everything else is genuinely doc-only Tier D. C9 is the only user-visible behavioral edit and it is behavior-preserving (verified above).
- **Missed/contradiction-creating items:** B1 (CLAUDE.md L140 replacement still wrong), B2 (7 stale index.html sync comments left), S2 (README L58 second version header), S1 (CLAUDE.md line drift L132 vs L138). These are the completeness gaps.
- **Not missed (credit):** the plan correctly catches the genuinely-stale README L223 "v16–v35.3", index.html L248 "19–33h", tech-appendix L13 vs L38 distance contradiction, and the L73 (already 4.9%) vs L570 (still 5.5%) ungauged-percentage inconsistency.

---

## Bottom line for the implementer
Proceed, with these gates: (1) fix B1's replacement string to "metadata counters, pending rows deleted, no per-row tiers"; (2) fix all eight `shared/model.js` sync comments, not just L112 (B2); (3) correct the CLAUDE.md target line (L132, S1) and add README L58 (S2); (4) make the C9 delete+gate edits atomic (S3); (5) fix the C7 "2.0→1" prose and extract the pure helper + test (S4/Q1). The numbers (C5/C38/C40/§8.1/travel-table/ungauged) all reproduce; the code edits are behavior-preserving; 407 tests pass today.

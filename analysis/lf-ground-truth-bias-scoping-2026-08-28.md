# LF Ground-Truth Bias / Estimand Mismatch (C32) — Scoping Plan

**Status:** SCOPED, AUDITED, and **substantially RETRACTED** — see §2. No analysis code written, no
model change proposed. Conclusion: this is a documentation matter and Option A closes it. This is step 1 of CLAUDE.md's Empirical Analysis Planning Protocol.
**Trigger:** TODO date-gate "Reassess LF ground-truth bias after 2026-08-27" — now due (2026-08-28).
The science review (`analysis/science-review-2026-06-10.md:211`) names this item as the home for the
C32 estimand discussion.

---

## 1. The problem, stated precisely

**C32 (major, confirmed by 3 independent lenses).** Every calibrated component of the nowcast targets
**Little Falls** discharge, not Great Falls:

| Component | What it is anchored to |
|---|---|
| EMA correction learning | residual `prediction − lf.q` (raw observed LF) |
| EF power law `126·EF^2.46` | fit against **LF** discharge |
| Empirical 90% CI (`EMPIRICAL_CI_90`) | quantiles of `prediction − LF` |
| Soft ceiling | `1.20 × lf.q` |
| Forecast validation | observed LF (now at `targetTime + travel`, v37.16) |

So the number the app labels "Great Falls flow" is structurally **"Little Falls discharge, one GF→LF
travel time ahead."** CLAUDE.md and the appendix are now explicit about this (§6.1 corrected
2026-08-28 — it previously claimed validation "calculate[s] what GF actually was", which was false).

**There is no Great Falls ground truth.** No USGS gauge, NPS station, or adjusted-flow series exists
at the falls (confirmed with the user, `analysis/travel-time-refit-plan-2026-06-17.md` D2). Nothing
in the system has ever observed GF discharge.

**Is it merely semantic?** Largely, yes — see the retraction in §2. Only ONE withdrawal sits between
Great Falls and the Little Falls gauge (the Washington Aqueduct's Little Falls intake, drawing from
the gage pool), it is partly offset by in-reach tributary inflow, and it drops to 0 MGD during
drought. The big diversions (WSSC at Swains Lock, Fairfax Water at Seneca, and the Aqueduct's own
Great Falls intake) are ABOVE the falls and so lower both points equally — they are PoR→GF model
bias, not an estimand wedge. What remains is a naming problem, not an accuracy problem.

---

## 2. ~~NEW this session: the wedge is quantified~~ — **RETRACTED 2026-08-28**

> **This section was WRONG and is retracted in full.** An independent audit refuted its central
> claim. The original text put the GF→LF wedge at ~243 cfs and argued it reaches 24% of flow at the
> discharge floor, "larger than the model's entire error budget". Both the magnitude and the
> direction were wrong. It is preserved only as a record of the error; **do not cite any number
> from the original version.**

**What was wrong, and why it should have been caught before writing:**

1. **WSSC is UPSTREAM of Great Falls, not in the reach.** Its intake is at Swains Lock (C&O canal
   mile ~16.6) — about 2.3 miles *above* the falls. That single misplacement accounted for ~82% of
   the claimed wedge. **This repository already said so**: `src/assets/tech-appendix.md` §9's
   water-withdrawal row states "Washington Aqueduct (at GF), WSSC (Swain's Lock), and Fairfax Water
   (Seneca) divert ~400-700 cfs **above the falls**." The fact was in the same document being
   edited, and the plan asserted the opposite without checking. Worse, the 2026-08-28 §6.1 edit
   shipped that contradiction live before it was caught.
2. **The in-reach term collapses to ZERO at drought flow — the argument was inverted.** ICPRB
   operator records through the September 2025 low-flow period show the Washington Aqueduct's
   Little Falls intake at **0 MGD** on every sampled day, with its entire load shifted to the
   above-falls Great Falls intake. The wedge is smallest exactly when the plan claimed it was
   largest.
3. **The offsetting in-reach inflow was omitted.** Difficult Run (01646000) and Cabin John Creek
   (01645704) add roughly 7–11 cfs back. `analysis/ema_nowcast_fix_audit.md` already had the
   correct balance: `LF = GF + DifficultRun + CabinJohn + seeps − WashAqueduct_diversion`.
4. **The 6.94% comparison was apples-to-oranges.** `avgErrorPercent` is a lifetime MAPE of the
   **corrected** estimate against LF — a constant offset is already absorbed by the correction, so
   it is not an unbudgeted error at all. Comparing a signed offset against a different target to a
   mean absolute error implies an additive error that does not exist.
5. **It was not new.** A 2026-02 three-agent investigation (v31.2, `src/assets/CHANGELOG.md`)
   already concluded withdrawals are absorbed by the LF-calibrated model and that systematic errors
   are 2–7× larger than total withdrawals, driven by ungauged area. The plan reopened a settled
   question with worse inputs.
6. **"ICPRB posts daily updates" was misleading.** Reporting is *episodic* — it runs only while
   drought monitoring is active (Point of Rocks below 2,000 cfs), roughly 11% of days, and is
   currently suspended. There is no JSON API; the numbers require scraping each report page.

**Corrected figures.** Net GF→LF wedge ≈ **−10 to +70 cfs**; approximately zero or slightly negative
during drought (Little Falls marginally *higher* than Great Falls). Against LF flows of 1,000–4,000
cfs that is low single-digit percent at worst, and nil when it would matter most.

**Better data source, missed entirely by the original plan:** USGS **01646502 "POTOMAC RIVER,
ADJUSTED, NEAR WASH, DC"** — same coordinates as 01646500, daily mean discharge back to 1930
(~34,940 values, ending 2025-10-31). `01646502 − 01646500` is the total diversion above the Little
Falls gauge. Daily-only and a basin total rather than per-intake, but it needs no scraping and no
third-party dependency. The science review had already used it.

**Consequence for this document:** the estimand mismatch is a **documentation** matter, not an
accuracy matter. §4–§6 below are revised accordingly.

## 3. What is and is not achievable

**Achievable:** reconstructing a *better-constrained* GF estimate as `LF + withdrawals` (a
mass-balance correction), and — more cheaply — quantifying how much of the learned EMA correction is
actually withdrawal signal rather than model bias.

**Not achievable:** observing GF flow. Any "GF truth" remains modelled. A withdrawal-corrected target
is a better-posed estimand, not a measurement.

**The honest null option is real:** if paddlers read Great Falls conditions off the Little Falls
gauge anyway (which the project has always argued), then targeting LF is *correct* and the only
defect is the documentation — which is now fixed. Changing the estimand could make the displayed
number less useful while being more "correct."

---

## 4. Candidate options (NOT a recommendation to implement)

### Option A — Documentation only. **DONE. This is the answer.**
Keep the LF estimand; state it precisely. §6.1 is corrected and now carries the true wedge
magnitude and the drought behaviour. Cost: none. Risk: none.

### Option B — ~~Diagnostic study~~ **WITHDRAWN (see §5).** Cannot separate the estimand wedge from
PoR→GF model bias, and is underpowered by construction.

### Option E — Offline replay against USGS 01646502 (**new, from the audit**).
Re-score the existing backtest using the published adjusted series as the target. Read-only, no
third-party dependency, ~95 years of daily data. The only empirical option worth running, and only
if someone wants the question closed empirically rather than arithmetically.

### Option C — Withdrawal-aware target (MAJOR model change).
Validate against `lf.q + withdrawals_in_reach` instead of raw `lf.q`. Would re-point the estimand at
something closer to true GF flow.
- ⚠ Invalidates every learned bin, the CI table, and the EF fit — all are LF-anchored.
- ⚠ Introduces a third-party data dependency with unknown uptime into the **live learning loop**.
- ⚠ Daily withdrawal data against an hourly model is a resolution mismatch.
- ⚠ Changes the displayed number for users who currently read it as an LF proxy.
- Would need a full pre-registered backtest gate, like v38.

### Option D — Display the wedge as a separate honesty signal.
Show "≈X cfs is withdrawn between here and the gauge" at low flow. Display-only, in the established
v37.13/v37.15 advisory pattern. Cheaper than C, keeps the estimand, makes the bias visible.

---

## 5. Recommendation — REVISED after audit

**Option A is complete, and the item can close.** With the wedge bounded at roughly −10 to +70 cfs
and ~0 at drought flow, the arithmetic answers the question: the LF estimand introduces no
meaningful systematic error into the displayed number, and what little there is the EMA already
absorbs. This reproduces the v31.2 conclusion from an independent direction.

**Option B is withdrawn — it cannot answer its own question.** Correlating learned corrections
against ICPRB or 01646502 totals would be uninformative, because ~90–100% of the diversion above the
Little Falls gauge is *above Great Falls* and is model bias the EMA should absorb. The test cannot
separate "absorbs the GF→LF estimand wedge" from "absorbs PoR→GF model bias". It is also
underpowered by construction: a 0–70 cfs signal against per-bin residuals in the hundreds to
thousands of cfs, with withdrawals anti-correlated with flow while corrections are binned *by* flow.

**Option D (display the wedge) is withdrawn** — built on the true figure it would display ≈0.

**If any empirical work is wanted, do Option E instead (new, from the audit):** an offline replay
scoring the existing backtest against 01646502 as the target. Zero live-loop risk, ~95 years of daily
data, no third-party dependency. Strictly better than Option B on both cost and information.

**Option C (change the validation target) stays rejected**, now with two stronger reasons than the
original: ICPRB's ~11% episodic coverage cannot support a live loop, and the 120% LF ceiling would
clip a withdrawal-corrected target, making the ceiling incoherent with the new estimand.

**Still not proposed:** any change to the estimate, the EMA bins, the CI table, or the ceiling.

## 6. Decisions needed from the user

1. **Is the LF estimand actually wrong for this product?** If paddlers want "what the LF gauge will
   read", the current target is right and this reduces to Options A/D. This is a product question,
   not a hydrology question, and it gates everything else.
2. **Proceed with the Option B diagnostic?** (read-only; needs the §2 data questions resolved first)
3. **Any appetite for a third-party data dependency (ICPRB) in the live loop at all?** If no,
   Option C is dead on arrival and should be recorded as such.

---

## 7. Verification path (for whatever is chosen)

- Option A: doc-only; skeptical re-read + the standard doc sweep. **Done for §6.1.**
- Option B: full Empirical Analysis Planning Protocol — plan → independent auditor → engage →
  blind dual-language (Python + R) → third-agent audit, per CLAUDE.md.
- Option C: additionally a pre-registered decision gate with thresholds fixed *before* the backtest,
  explicitly modelled on `analysis/v38_gate_verdict_2026-07-20.md`.

**Sources for §2:** ICPRB CO-OP daily flow and demand updates
(https://icprbcoop.org/node/671, https://icprbcoop.org/node/670) and ICPRB drought operations
documentation (https://www.potomacriver.org/wp-content/uploads/2014/12/ICPRB07-03.pdf).
Intake-location and magnitude figures are from those daily reports and have **not** been
independently verified against operator records — see the §2 warning.

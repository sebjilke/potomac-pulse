# LF Ground-Truth Bias / Estimand Mismatch (C32) — Scoping Plan

**Status:** SCOPING — no analysis code written, no model change proposed. Awaiting independent audit
+ user direction. This is step 1 of CLAUDE.md's Empirical Analysis Planning Protocol.
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

**Why this is not merely semantic.** Municipal water withdrawals occur in the GF→LF reach, so LF
discharge is *structurally lower* than GF discharge by that wedge. The EMA correction absorbs the
wedge silently instead of modelling it — it is learned as if it were model bias.

---

## 2. NEW this session: the wedge is quantified, and it is not small

Withdrawal operators and intake locations (ICPRB CO-OP daily reports; example day 2024-11-17):

| Withdrawal | Location | Rate (example) | In the GF→LF reach? |
|---|---|---|---|
| Washington Aqueduct — Great Falls intake | at Great Falls | 88 MGD ≈ **136 cfs** | No — at/above the GF reference point |
| Washington Aqueduct — Little Falls intake | at Little Falls | 28 MGD ≈ **43 cfs** | **Yes** (pending gauge-vs-intake ordering) |
| WSSC Potomac WFP | near Potomac, MD (below GF) | 129 MGD ≈ **200 cfs** | **Yes** |

**GF→LF wedge ≈ 243 cfs** on that example day. As a fraction of LF flow:

| LF flow (cfs) | wedge |
|---|---|
| 1,000 (drought / discharge floor) | **24.3%** |
| 2,000 (CO-OP monitoring threshold) | **12.1%** |
| 2,800 | 8.7% |
| 4,110 (today) | 5.9% |
| 10,000 | 2.4% |

For comparison the model's current live mean |error| is **6.94%**. **At low flow the withdrawal
wedge is larger than the model's entire error budget** — and low flow is exactly where the
travel-time model is least constrained (§3.2 of the appendix) and where paddlers care most about
whether the falls are runnable.

**Crucially, this data is published.** ICPRB CO-OP posts daily flow-and-demand updates, and
monitoring becomes daily-reported once Point of Rocks drops below 2,000 cfs. So the wedge is
**potentially identifiable** — which contradicts the earlier assumption (baked into the C32 write-up)
that it is unidentifiable in principle. It is unidentifiable *from USGS gauges alone*; it may not be
unidentifiable *full stop*.

⚠ **Unverified and load-bearing:** (a) whether the WA Little Falls intake sits upstream or downstream
of the 01646500 gauge — if downstream, it does NOT belong in the wedge and the figure drops to
~200 cfs; (b) whether ICPRB exposes a machine-readable feed or only human-readable daily posts;
(c) historical coverage and resolution (daily vs hourly) for a backtest. **All three must be
resolved before any modelling decision.**

---

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

### Option A — Documentation only. **Already partly done; the conservative default.**
Keep the LF estimand; state it precisely everywhere. §6.1 is fixed; the appendix now names the
withdrawal wedge. Cost: none. Risk: none. Leaves the low-flow bias in place but *disclosed*.

### Option B — Diagnostic study, no model change. **RECOMMENDED NEXT STEP.**
Ask one bounded empirical question: *does the learned EMA correction correlate with withdrawal
rate?* If the corrections in the low-flow bins track ICPRB withdrawals, that confirms the EMA is
absorbing the wedge and quantifies how much. Read-only; no estimate change; produces the evidence any
later decision needs. Blocked only on §2's data-availability questions.

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

## 5. Recommendation

**Option A is already banked. Do Option B next, and nothing else yet.** The wedge arithmetic in §2 is
suggestive enough to justify a diagnostic but nowhere near enough to justify touching the live
learning loop. Option C is the kind of change that failed at the v38 gate for good reasons — a
third-party feed inside the learning loop is a bigger reliability liability than the bias it fixes.
Option D is attractive but should follow B, not precede it, so the displayed number is grounded in
measured duty rather than an example day.

**Explicitly not proposed:** any change to the estimate, the EMA bins, the CI table, or the ceiling.

---

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

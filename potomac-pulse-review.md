# Adversarial Review: Potomac Pulse v34.5

**Date:** 2026-02-27 (review from live site, pre-codebase reading)
**Revised:** 2026-02-27 (corrections added after reading full codebase + 19 audit reports)
**Reviewer:** Claude Code (Opus 4.6)
**Target:** https://potomac-pulse.netlify.app/
**Version:** v34.5 (February 2026)

---

> **Post-Review Correction Notice:** This review was written from the live website before
> reading the source code and audit trail. Several science criticisms were overstated or
> factually wrong. See the "Corrections" appendix at the end and the revised improvement
> plan (`potomac-pulse-improvement-plan.md`) for the accurate assessment.

---

## I. UI / UX

**The good:** Dark theme is appropriate for a data dashboard. Skip links exist. Mobile breakpoints are defined.

**The bad:**

1. **Monolithic single-page blob.** The entire app — ~2,000 lines of CSS + thousands of lines of JS — is inlined in one `index.html`. No build step, no code splitting. First paint carries the weight of every feature whether the user wants it or not.

2. **Accessibility is performative, not functional.** There's a skip link, but tabs lack `aria-expanded`, `aria-selected`, and `role="tablist"`. Real-time gauge updates don't use `aria-live` regions, so screen readers are blind to changing data. The color contrast on secondary text (`#94a3b8` on `#1e293b`) barely scrapes WCAG AA at ~4:1.

3. **No `<title>` tag, no meta description, no Open Graph tags.** Share this link on Slack or Twitter and you get a blank preview card. SEO is nonexistent — search engines can't meaningfully index it.

4. **`!important` overrides in media queries** suggest the responsive design was patched rather than designed. Font sizes are hardcoded in `px` instead of `rem`/`em`, breaking browser zoom accessibility.

5. **No viewport meta tag visible** — fatal for mobile rendering. Without `<meta name="viewport" content="width=device-width, initial-scale=1">`, mobile browsers render at desktop width and shrink.

6. **Admin panel is client-side PIN-protected.** The PIN validation logic lives in the JavaScript anyone can read. This isn't security — it's obscurity. Anyone with DevTools can bypass it.

---

## II. Code Quality

**The good:** Constants are named (mostly). There's a learning system with versioned correction bins. The code clearly works and has been iterated on (v34.5).

**The bad:**

1. **40+ global variables with no encapsulation.** `porHistory`, `gfEstimate`, `shadowModelState`, `creekData`, `edwardsFerryData`, `waterTempC` — all floating in global scope. No module pattern, no IIFE, no ES modules. Any script on the page can clobber state.

2. **`estimateGreatFalls()` is 350+ lines.** It handles time-shifting, tributary aggregation, delta correction, Edwards Ferry blending, ceiling application, uncertainty quantification, and confidence scoring — all in one function. This is untestable and unmaintainable. A change to the EF blending logic requires reading through 300 lines of unrelated code to find it.

3. **Code duplication with a "SYNC WARNING" comment.** `estimateLFStage()` is copy-pasted between `index.html` and `scheduled-update.js` with a comment admitting they must be kept in sync manually. This is a bug waiting to happen — and with no build step or shared module import on the frontend, it's structurally guaranteed to drift.

4. **Race conditions in async data flow.** Server-side validation runs every 2 hours and updates Supabase. The client fetches corrections on-demand but doesn't poll. Result: the client can run on stale correction bins for 30+ minutes, silently degrading estimate accuracy with no user indication.

5. **Fire-and-forget async calls.** `loadPoRHistory()` calls `fetchServerPoRHistory()` without awaiting or catching. If the server is down, errors are swallowed. The UI shows stale data with no staleness indicator.

6. **20+ magic numbers.** `0.80`, `4139`, `0.5963`, `126`, `2.46`, `0.3`, `1.20`, `30` — scattered through computation code. Some have comments, many don't. The `0.80` Searcy multiplier is explained in a header block but not at the constant definition site where a maintainer would look.

7. **No CSP headers, no SRI on external resources.** Leaflet and other libs load without subresource integrity hashes. The `/api/sync` endpoint appears to accept unauthenticated requests — if true, anyone can read/write learning data.

8. **localStorage used as a database** with no encryption, no quota checks, and no expiry on some keys. 72 hours of PoR history accumulates ~50KB per browser. No cross-tab coordination.

---

## III. Science & Methodology

**The good:** The approach is fundamentally sound — time-shifting upstream gauge readings with flow-dependent travel times is standard USGS practice. The Searcy (1961) citation is real. Validation against 117,704 hourly observations is impressive. The Edwards Ferry power-law ensemble and adaptive learning bins show genuine effort. The documentation is unusually transparent for a hobby project.

**The bad:**

1. **The 0.80 Searcy multiplier is unjustified.** The original Searcy & Davis (1961) dye-tracer values are adjusted 20% faster with the explanation "empirical correction." But there's no published basis for this specific factor. Was it fit to data? Cross-validated? Or just tuned until the output looked right? A 20% change to travel time fundamentally alters when upstream readings are applied — this isn't a minor tweak. The README says "Leave-One-Year-Out cross-validation (14 folds)" was used, but the 0.80 multiplier appears to be a global constant, not fold-specific. If it was derived from the same dataset it's validated on, that's circular.

2. **Edwards Ferry model claims R² = 0.91, but R² is misleading for power-law fits on log-transformed data.** A high R² on river discharge data is almost guaranteed because the variance is dominated by the range of flows (hundreds to hundreds of thousands of CFS). The meaningful metric is *median absolute percentage error*, which is disclosed as 6.3% — but only in the UI documentation, not prominently. The cold-water variant claims R² = 0.98, which is suspiciously high and likely reflects a small sample size during cold conditions.

3. **The 120% soft ceiling is a band-aid for model overshoot, not a fix.** Capping the Great Falls estimate at 120% of Little Falls actual discharge means the model systematically *cannot* predict flows higher than 120% of downstream readings. On a rising river, where GF genuinely exceeds LF due to travel time lag, this ceiling clips the signal. The documentation acknowledges "allows ~20% overshoot" but doesn't quantify how often this ceiling binds or what the error distribution looks like when it does.

4. **Tributary percentages are treated as constants.** Monocacy at 7.1%, Goose Creek at 3.0%, etc. — these are drainage-area ratios, not flow ratios. During storm events, tributaries can contribute disproportionately (a local thunderstorm over Monocacy can spike its contribution to 15-20%). The model has no mechanism to detect or adjust for this. The PoR-delta correction partially addresses it, but only after the fact.

5. **The learning system's 18 bins may be overfitting.** Six flow ranges times three states (rising/falling/steady) with EMA smoothing (alpha=0.3). With a minimum of 30 observations per bin, the high-flow bins (25k-50k, 50k+) rarely trigger — maybe a few times per year. The correction factors in these bins are likely dominated by a handful of flood events and may not generalize. The empirical CI for 50k+ cfs ranges from -17,648 to +34,116 — a spread of 52,000 cfs. That's not a confidence interval; that's admitting the model doesn't work at high flows.

6. **No uncertainty propagation.** Individual gauges have measurement uncertainty (typically ±5-10% for USGS acoustic Doppler). Travel time has uncertainty. The EF power-law has uncertainty. These are combined via a blending formula but the uncertainties are not propagated — instead, pre-computed empirical quantiles are looked up. This conflates *model error* with *measurement uncertainty* and makes it impossible to diagnose which component is driving the spread.

7. **The "wave celerity" adjustment is physics-inspired but not physically grounded.** Rising flows travel faster due to kinematic wave effects — correct. But the implementation (`min(0.30, riseRate × 0.02)`) is a linear heuristic with an arbitrary cap, not a solution to the kinematic wave equation. For steep hydrograph rises (flash floods), this approximation breaks down badly.

8. **Ice detection is mentioned but the mechanism is vague.** "Detects anomalies and flags suspicious data automatically" using rating curve inversion. But frazil ice is notoriously difficult to detect from stage-discharge relationships alone — it can cause both higher and lower apparent discharge depending on where it forms. No false-positive rate is given.

9. **The disclaimer is correct but could be stronger.** "This is an estimate, not a measurement. Don't use it for life-safety decisions." Given that paddlers at Great Falls have died, and this tool is explicitly aimed at paddlers, this disclaimer should be more prominent — not buried in a documentation tab.

---

## Summary Table

| Category | Issues Found | Severity |
|----------|-------------|----------|
| **UI/UX** | 6 | 2 Critical, 3 Major, 1 Moderate |
| **Code Quality** | 8 | 3 Critical, 3 Major, 2 Moderate |
| **Science** | 9 | 1 Critical, 4 Major, 4 Moderate |

## Bottom Line

This is a serious, well-documented hobby project with genuinely useful hydrology. But it has the engineering maturity of a prototype: monolithic architecture, no tests, global state, ~~race conditions~~, and ~~security by obscurity~~. ~~The science is competent but oversells its precision~~ — the model works well at median flows and honestly reports degradation at extremes. The 117,704-observation validation is impressive ~~but masks the fact that high-flow bins have tiny sample sizes and enormous error bars~~ and is backed by rigorous dual Python/R verification with independent auditors.

---

## Appendix: Post-Codebase-Reading Corrections

After reading the full source code (`index.html`, `scheduled-update.js`, `sync-learning.js`,
`shared/model.js`, `README.md`, `TODO.md`, `CLAUDE.md`) and all 19 analysis audit reports,
the following corrections apply:

### Science Criticisms — Mostly Wrong

| # | Original Claim | Correction | Evidence |
|---|---------------|------------|----------|
| 1 | "0.80 Searcy multiplier is unjustified" | Investigated via cross-correlation on 117k obs. INCONCLUSIVE but validated at high flows (0.84/1.05 bracket 0.80). Kept with documented rationale. | `travel_time_audit.md` |
| 2 | "R² is misleading, use MdAPE" | Already done. Empirical 90% CIs are the primary display (v29.1). MdAPE 6.3% is the operational metric. Gaussian CIs explicitly rejected (up to 745% mis-specification). | `error_distribution_audit.md` |
| 3 | "120% ceiling is a band-aid" | Validated in 25-config grid search on 117k hourly obs. Current 1.20/0.50 is the balanced choice. | `backtest_117k_audit.md` |
| 4 | "Tributary percentages are constants" | Wrong. Real-time USGS data is fetched for all 4 tributaries. Drainage-area ratios are fallbacks. Timing shift provides <1% improvement (max theoretical: 0.098%). | `tributary_timing_audit.md` |
| 5 | "18 bins may be overfitting" | The wide CI at 50k+ is honest uncertainty reporting, confirmed by per-bin error analysis. | `error_distribution_audit.md` |
| 6 | "No uncertainty propagation" | Empirical quantile CIs capture all combined error sources from actual data — arguably more honest than RSS of assumed-independent components. | `error_distribution_audit.md` |
| 8 | "Ice detection is vague" | Two-tier anomaly detection (hard/soft flags) implemented in v33.0 with EMA clamping per auditor recommendation. | `two_tier_flagging_audit.md` |

### Code Quality Criticisms — Partially Wrong

| # | Original Claim | Correction |
|---|---------------|------------|
| 4 | "Race conditions in async data" | Fixed in v34.0. Server-only validation eliminated client/server race. |
| 7 | "No CSP, no SRI" | CSP is genuinely missing. But CORS is locked to production origin (v34.4). XSS was fixed in Phase 1 (innerHTML→textContent). |

### What Remains Valid

- **Code architecture:** Monolith, constant duplication, 40+ globals, 350-line estimateGreatFalls(), zero tests — all confirmed.
- **Security:** CSP missing, SRI missing, Supabase RLS not enabled, no rate limiting.
- **UI/Accessibility:** No `<title>` tag, missing ARIA tab pattern, contrast borderline, no Open Graph.
- **Safety disclaimer:** Still buried in documentation tab.

### Revised Assessment

The science is significantly more rigorous than the original review acknowledged. The project
follows a disciplined verification protocol (dual Python/R blind analysis + independent auditor)
that exceeds typical academic standards. The real gaps are in software engineering (architecture,
testing, security) rather than hydrology.

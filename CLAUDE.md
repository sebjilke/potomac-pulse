# Potomac Pulse — Claude Instructions

## Workflow Rules
- **Always commit and push** after completing code changes unless explicitly told not to. Never defer commits.
- **Complete ALL steps in sequence.** On multi-step tasks, do not skip or defer later steps as "post-deploy" or "for later" unless the user explicitly says to stop.
- **Before deleting or reverting anything, confirm** what specifically should be changed. Do not assume intent from ambiguous references like "delete it."
- **Verify required env vars** (`ADMIN_PIN`, Supabase keys, Netlify credentials) are accessible before making API calls that depend on them.

## File Handling
When working with PowerPoint/presentation files, prefer using python-pptx via Bash
over MCP tools for reading and modifying slide content, as MCP-based PowerPoint
reading is unreliable. (Delete this section if MCP tools improve.)

## Scientific/Modeling Work
For hydrological/scientific modeling tasks, always discuss the approach and get
explicit confirmation on methodology (e.g., continuous vs categorical, interpolation
methods) BEFORE implementing. Present the design as a brief numbered plan first.

## Empirical Analysis Planning Protocol
Every empirical analysis (horse races, model comparisons, optimization studies,
backtests) MUST follow a plan-first workflow:

1. **Write a detailed plan** as a markdown document in `/analysis/` before writing
   any analysis code. The plan must specify: approaches to test, evaluation framework
   (metrics, cross-validation design, subsets), data sources, and expected outcomes.
2. **Launch an independent auditor subagent** to review the plan and make
   recommendations. The auditor should critique methodology, flag missing approaches,
   identify data concerns, and suggest evaluation framework improvements.
3. **Engage with the auditor's recommendations**: Accept good recommendations and
   incorporate them into a revised plan. Reject recommendations only with explicit
   reasoning. Document which recommendations were accepted/rejected.
4. **Only then** proceed to write and execute analysis scripts.

This prevents wasted compute on flawed designs and ensures methodological rigor
before any code is written.

## Code-Change Verification Protocol
For any task that requires writing new code or rewriting existing code:

1. **Plan first.** Before touching files, articulate: which files change, what changes, why, what tests will catch regressions, what side effects to expect.
2. **Independent auditor reviews the plan.** Spawn a fresh subagent (NOT the one that drafted the plan) and have it critique methodology, missing tests, side effects, and doc impact. Each finding marked RESOLVED / PARTIAL / NOT RESOLVED.
3. **Engage with the audit.** Accept good recommendations. Reject only with explicit reasoning. Update the plan.
4. **Then implement.** No code changes until plan + audit are complete.
5. **Re-audit after implementation.** A fresh auditor verifies each prior finding was addressed and the implementation matches the plan.

Applies to: new features, refactors, schema changes, bug fixes that touch load-bearing code (`shared/model.js`, `scheduled-update.js`, `sync-learning.js`, `great-falls.js`, anything in `src/estimation/` or `src/learning/`).

Skip for: typo or comment fixes, doc-only updates, version bumps without logic changes, test additions for existing behavior, single-line config tweaks. When in doubt, run the protocol.

## Task Decomposition for Larger Work
For tasks too big to land as a single coherent change (multi-file features, new model components, multi-step migrations):

1. **Decompose into discrete subtasks** — each with a single clear deliverable and minimal cross-dependencies.
2. **Assign each subtask to its own subagent.** Launch in parallel where dependencies allow.
3. **Orchestrator on top.** The main agent (this one) holds the plan, sequences subtask launches, integrates results, and resolves conflicts — does NOT do subtask work itself.
4. **Cross-subtask audit.** When subagents finish, an independent auditor verifies the integrated result is internally consistent (client/server alignment, doc references resolve, version refs match, no orphaned dead code).

## Analysis Verification
All statistical analyses, model fits, and data transformations MUST be verified:

1. **Blind dual-language**: Launch Python and R subagents simultaneously (new, separate, results-blind). Results must match within floating-point tolerance (<0.01).
2. **Independent auditor**: Third subagent (never one that ran the analysis) verifies cross-language agreement, methodology, data integrity, and spot-checks ≥5 observations against live USGS API.
3. **Data provenance**: Every CSV must have a generating script. No silent drops or additions.
4. **Fail-fast**: If Python/R diverge, STOP and investigate. Never average or pick one.
5. **Audit trail**: Save all outputs to `/analysis/` (`*_python.csv`, `*_R.csv`, `*_audit.md`).

## Deployment & Verification
For significant changes to web applications (new features, bug fixes, UI changes),
verify the deployment works end-to-end in the browser using Chrome MCP tools before
considering the task complete. Skip for trivial changes (typos, comments, formatting).

## Behavioral Defaults
- Before implementing non-trivial features, outline 2-3 possible approaches with
  tradeoffs. Wait for confirmation before proceeding.
- For multi-step tasks, maintain a todo list and update it as work progresses.

## Quick Follow-ups
When the user asks for a small adjustment to work just completed (e.g., "only change
I'd recommend...", "one tweak...", "also make X..."), just do it directly. Don't
enter planning mode — treat them as continuation of the previous task.

## Analysis Data Files
Analysis data, scripts, and audit reports are in `/analysis/`. Each CSV has a generating script.
⚠ Column `ef_temp_c` in `ef_lf_temp_merged.csv` is actually PoR temp (01638500), not EF. Legacy name — do not rename (would break scripts).

## Versioning Rules
Format: **vMAJOR.MINOR** (e.g., v25.0, v25.1, v25.2)

- **MAJOR** (v25 → v26): New estimation approach, model recalibration, architectural change,
  or anything that changes the core GF estimation output for the same inputs.
- **MINOR** (.0 → .1): Bug fixes, UI changes, new tabs/features, documentation updates,
  display changes — anything that doesn't alter the core estimation logic.
- **No patch level**: We don't use v25.0.1. If a minor fix is needed, bump the minor.
- Always update: version in `CLAUDE.md`, version history in Tech Appendix, `Generated by` footer.
- Always update `README.md` at the end of every commit to reflect the changes made.
- Keep `src/model/shared-model.js` and `netlify/functions/shared/model.js` in sync for any model logic change (also `src/model/constants.js` ↔ the server constants block).

## Model Mechanisms

### Nowcast (GF Estimate)
Works upstream → downstream. Takes observed PoR discharge (~5–50h travel time to GF, flow-dependent: ~19h median, up to ~50h near the 1,000-cfs floor),
adds tributary inflows (Monocacy 7.1%, Goose Creek 3.0%, Broad Run 0.66%, Seneca 0.87%), blends in
EF power-law estimate (flow-dependent weight: near 0% at low flows, ~40% at high), applies a PoR-delta
correction for rising/falling rivers, end-applies the learned EMA bin correction at unit gain (after the
ensemble), and caps the result at 120% of observed LF (a display-only guard). v36.0: client and server
apply the correction identically via a shared helper (`applyGFCorrection`), so the displayed estimate
equals the validated one.

**Learning**: The server validates pending predictions against actual LF. The EMA learns on the RAW
residual (uncorrected final estimate − actual) so the correction equals the raw model's bias with no
feedback loop; the headline accuracy scores the CORRECTED residual, prequentially. Signed error stored in
18 bins (6 flow ranges × 3 flow states), each an EMA (alpha=0.3). Server-only and server-sole-writer — the
client neither learns nor posts predictions (the cron is the only writer, v36.0). Validates against raw
LF; corrections naturally absorb ungauged tributary and withdrawal signal.

### Forecast (48h)
Works differently from nowcast — uses NWS predictions for the *downstream* gauge (Little Falls) rather
than pushing upstream readings forward. For each future hour: takes NWS LF forecast, offsets by
GF-to-LF travel time (~6.5h baseline, flow-adjusted), applies additive bias correction (gap between
current NWS LF forecast and actual observed LF), blends NWS EF forecast when available (same logistic
weight as nowcast). Falls back to NWS PoR forecast if LF unavailable, or linear extrapolation if no
NWS data at all.

**Validation**: Scores model forecast against two NWS baselines (raw and bias-corrected) at each
horizon (6/12/24/48h). Stored as `gf_forecast_pending` → validated when water arrives at LF.

### Key files
`src/estimation/great-falls.js` + `src/model/shared-model.js` (client) and `netlify/functions/scheduled-update.js` + `netlify/functions/shared/model.js` (server) — keep in sync for any model logic change.
Client estimation: `src/estimation/great-falls.js`. Forecast UI: `src/ui/great-falls-ui.js`.
NWS integration: `src/estimation/nws.js`. Learning UI: `src/ui/learning-ui.js`.

## Current Model Parameters (v36.3)

- **EF Power-Law**: 126×EF^2.46 (default), 160×EF^2.36 (cold water ≤10°C)
- **EF Weight (Logistic Ramp)**: `ef_weight = 0.40 / (1 + exp(-5.0 × (ln(flow) - ln(10000))))`. Near 0% at low flows, ~40% at high. EF has negative predictive skill below 6k cfs.
- **PoR-Delta Correction**: Observed PoR change ratio × wave-travel decay (cap 0.50)
- **Soft LF Ceiling**: corrected GF estimate capped at 120% of LF actual — display-only guard applied AFTER the end-apply correction; the EMA learns on the unclipped raw, so the ceiling never censors learning (v36.0)
- **Empirical 90% CI (v36.1, C2)**: Per-(flowBin × flowState) q05/q95 of the **corrected** residual `r = estimate − actual`. Lookup table `EMPIRICAL_CI_90` in `src/model/constants.js`. Display-only, applied **sign-aware and asymmetric** as `[estimate − q95, estimate − q05]` (the v36.0 symmetric `±(q95−q05)/2` is gone). Re-derived by replaying the real model over 126,916 hourly obs (incl. tributaries + LF stage) in a prequential EMA backtest; high-flow bins use the wider of multi/single-pending tails. An *LF-equivalent-flow* band. See `analysis/ci_v36.1_backtest_plan.md`.
- **Tributaries**: Monocacy (7.1%), Goose Creek (3.0%), Broad Run (0.66%), Seneca (0.87%). Catoctin Creek excluded (enters above PoR gauge — would double-count).
- **Two-Tier Anomaly Flagging**: Hard flags (data corruption) skip learning AND accuracy. Soft flags (model disagreement) included in both (EMA clamped ±2σ). Flags are computed per validation and gate learning/accuracy — they are NOT persisted as a gauge_id tier; the pending row is deleted on validation (stored gauge_id values: only `system`, `pending`, and bin keys).
- **EMA Learning**: Server-only and server-sole-writer (client `checkGFValidations()` and prediction posting both disabled — the cron is the only writer). End-applied at unit gain so displayed == validated; learns on the RAW residual, headline scores the corrected model (v36.0). Validation capped at 2.5h after validationDue. Forecast-based learning rejected (domain mismatch).
- **Hierarchical Correction Fallback**: Bins with <5 obs blend with fallback: same-bin cross-state average → adjacent bin → 0. Linear blend: `weight = count/5`.

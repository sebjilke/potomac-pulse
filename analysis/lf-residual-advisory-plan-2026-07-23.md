# v37.15 — LF-Residual Advisory (second display-honesty signal) — Plan (2026-07-23)

**Status:** PLAN, audited (10 findings F1–F10, ALL ACCEPTED — §8) → implement →
fresh re-audit. User-approved 2026-07-23 ("lets do R2") after the decision-gated
backtest below. Amendments from the audit are folded into §§0–7.
**Scope:** NO estimate change, NO learning change, NO weight change. Server detects
"our own recent validations ran badly low", client shows a second display-only advisory.
MINOR bump v37.14 → v37.15. Sibling of the v37.13 EF-divergence advisory; reuses its
plumbing patterns wholesale.

## 0. Motivation and evidence base

**Motivating event (2026-07-22):** convective storm over the lower basin (Seneca 53 →
1,210 cfs in 4h); LF rose ~+800 cfs six hours before PoR's rise arrived. The model
under-read −21% at 07:13 UTC (hard-flagged) and −14.3% at 19:06 UTC. The EF-divergence
advisory NEVER fired: D̄ peaked at 1.146 (< 1.20 ON) and fell to 0.837 — Seneca and the
smaller locals enter **below Edwards Ferry**, so EF is structurally blind to this class
(the v38 gate's central finding: 4 of 6 historical below-PoR windows had D̄ max
0.84–0.98). The LF residual is the only observable that sees every event of the class,
because LF sits below all the ungauged inflow.

**Backtest (decision gate, run 2026-07-23):** `analysis/lf_residual_advisory_backtest.py`
on the frozen, audited v38 dataset — signal stream = `v38_residuals_single.csv`
(production single-pending cadence, disp_c0 = displayed estimate; a pair becomes
observable only at its valTs), duty denominator = the 126,199 site-live grid hours.
Four pre-stated rules swept; R2 selected by the user:

| Metric (R2: ON err ≤ −15%, OFF err > −7.5%, stale 12h) | Value |
|---|---|
| Duty (all hours) | **4.93%** (JJA 0–3k: 5.04%) |
| Big misses (≤ −25%) whose prediction was made while ON | **44.5%** (109/245) |
| Misses ≤ −15% covered | 43.5% (291/669) |
| ON predictions that then scored ≤ −10% | **47.3%** |
| Normal pairs made while ON: med \|err\| / P(≤−25%) / mean | **10.6% / 12.1% / −10.2%** (n=857) |
| Normal pairs made while OFF: same | 1.8% / 0.58% / +0.1% (n=22,204) |

(2026-07-22 is OUTSIDE the frozen dataset — the statement "it would have fired from
the 07:13 UTC −21% validation onward" is threshold arithmetic on the live DB rows
(−21% ≤ −15% latches; the 19:06 −14.3% is a deadband hold), not a backtest output — F7c.)

**R2 vs R4 on the record (F10):** R4 (ON −25% / OFF −10%) meets the pre-registered
duty bound (2.25%) with higher truthfulness (55.8% vs 47.3%) but only ~⅔ the big-miss
coverage (30.6% vs 44.5%) — and would NOT have fired on the motivating −21% event.
The user chose R2 knowing it exceeds the duty bound; R4 was the compliant alternative.

Contrast with the v38 gate's false-activation finding: EF-divergence-ON hours were only
~2.4× worse than baseline; LF-residual-ON hours are ~6× worse on median error with a
~21× big-miss rate — these are mostly TRUE alarms. Known, accepted limitations:
- **Always late.** A reactive signal cannot fire before the first bad validation
  arrives (3–6h single-pending cadence). The first miss of every episode is unflagged.
- Historical window coverage 6–66% with first-fire lags up to ~72h (windows open before
  events peak). Coverage ~44% of big misses is near the ceiling of the design.
- Pre-stated duty bound (≤2–3%) is exceeded at 4.9%. Accepted by the user with eyes
  open: the bound's premise (high duty = crying wolf) was falsified by the ON-hours
  degradation evidence above.
- Off-season (non-JJA/SON) duty runs ~3–5% in the reported cells (the seasonal
  printout buckets Dec–May as "other" and hides cells <2%, so a precise winter figure
  is not derivable from the committed outputs — F7d).
- Backtest data provenance: reuses the v38 dataset audited 2026-07-20 (incl. ≥5 live
  USGS spot checks); no new data was fetched. **Dual-language verification DONE
  (2026-07-23): a blind R replication (`lf_residual_advisory_backtest_R.R`, written
  from spec only, never shown the Python script or results) reproduced every metric —
  identical pair count 23,174 / grid 126,199, worst delta 0.005 after the Python
  script was extended to compute the harm-coverage and truthfulness metrics with
  counts (F1, the audit's blocker: those three decision metrics had been R-only).**
  Both scripts + the results CSVs are the audit trail.

## 1. Server — detector

**Signal:** every completed validation this cron cycle — BOTH the regular path
(`storeValidationPair`) and the hard-flag path (`validation_failure`), because the
motivating misses were hard-flagged and the backtest stream contained all matured
pendings. Signed error = `errorPercentCorrected` (corrected/displayed estimate vs LF,
same convention as the backtest's `(disp_c0 − actualLF)/actualLF`; negative =
under-read). Risk accepted, BOTH directions (F4): (a) a corrupted-HIGH LF reading
could false-trigger; (b) the LF-corruption hard flags are structurally one-sided
toward corrupt-LOW readings (`STAGE_DISCHARGE` fires only when stage-implied flow
exceeds reported discharge; `LOW_FLOW_HIGH_STAGE` is the ice signature) — both produce
large POSITIVE errPct, which would false-CLEAR a genuinely latched state (one frazil-ice
reading can kill a true alarm in winter; there is deliberately no cold lockout).
Accepted with documentation rather than special-cased: backtest fidelity beats
flag-reason filtering the backtest never modeled, such rows are rare (11 in the whole
`validation_failure` table — verified against the live DB 2026-07-22, as was the fact
that the motivating −21% miss was a hard-flagged row), the next qualifying pair
re-latches, and the whole feature is display-only. Production sees provisional LF
where the backtest saw QC'd historical data — unmeasured, noted.

**Plumbing:**
- `validatePendingPredictions` additionally returns
  `pairs: [{ at: <epoch ms>, errPct: errorPercentCorrected, hardFlagged: boolean }]`
  for every pending it validates this cycle. **Return contract (F3):** the function has
  three early paths that return BARE `0` (scheduled-update.js:927/:933/:946, pinned by
  two tests asserting `result === 0`) — these stay bare; only the successful path's
  object gains `pairs`. The handler accesses it defensively
  (`validationResult.pairs || []`, which also covers the bare-0 paths), and the two
  pinning tests stay untouched.
  Note (F5): production is single-pending by construction (unique `(observation_type,
  gauge_id)` key + `storePrediction` skip), so `pairs.length ≤ 1` every cycle — the
  multi-pair handling is defensive only, and `updateLfResidualState` sorts `pairs` by
  `at` internally rather than trusting caller order.
- New pure function `updateLfResidualState(prevState, { nowMs, pairs, lfCFS })` in
  `netlify/functions/shared/model.js` (server-only block, beside
  `updateEfDivergenceState`), constants
  `LF_RESIDUAL = { onPct: -15, offPct: -7.5, signalStaleMs: 12h, clientStaleMs: 2h }`.
  Exact backtest semantics:
  - Pairs applied in `at` order: `errPct <= onPct` → `latched = true`;
    `errPct > offPct` → `latched = false`; between → hold.
  - `lastPairAt` / `lastErrPct` track the newest pair ever seen (persisted across
    cycles).
  - `active = latched && (nowMs − lastPairAt) <= signalStaleMs` — **the latch survives
    staleness suppression** (backtest fidelity: a mid-deadband pair after a gap
    refreshes `lastPairAt` and the advisory resumes without re-crossing −15%).
  - `activeSince` follows effective `active` (reset on any active→inactive, including
    staleness suppression).
  - No cold lockout and no month proxy: the signal is the model's own scorecard, valid
    year-round (backtest included all seasons; winter duty 2–5%). Ice suspends
    validation entirely (handler step 4 gate), so the state simply goes stale.
- **Episode documentation (v37.14 parity):** while active, accumulate
  `{ startedAt, cycles, worstErrPct, pairCount, sumErrPct, minLF, maxLF,
  trail: [{t, errPct, lf}] (one entry per PAIR, capped 336, overflow counted) }`;
  the handler emits it as an append-only `lf_residual_episode` row on the
  active→inactive transition, adding `endedAt` and `meanErrPct = sumErrPct/pairCount`.
- **Handler step 5c** (right after 5b, same shape): runs EVERY cycle (ice or not — the
  state must decay), wrapped non-fatal; reads `(lf_residual, 'state')` INSIDE the 5c
  block (immediately before compute+write, minimizing the read-to-write race window),
  calls the pure updater with this cycle's `pairs` (empty array when step 4 was skipped
  or validated nothing), upserts the state row, emits the episode row on deactivation.
- **Concurrency guard (F2):** overlapping cron runs are real (the C12 defenses exist
  because they happen). Hazard here: run A validates the pair and latches ON; run B,
  with no pairs, writes afterward from a stale read and erases the latch — suppressing
  the advisory until the next bad validation, in a feature that is already always-late.
  Guard: the handler records `runStartMs = Date.now()` at entry; in 5c, if
  `pairs.length === 0` AND the freshly-read state's `updatedAt` parses NEWER than
  `runStartMs`, another run wrote during ours — SKIP the write entirely (our no-pair
  update adds nothing but a timestamp; the other run's state is fresher and its own
  cycles keep decaying staleness). When `pairs.length > 0` we always write (only one
  run can hold a given pair — the pending row is claim-deleted). Residual last-writer
  races beyond this are accepted like the sibling's F14: display-only, self-healing on
  the next validation.
- **Stamps:** the new prediction gains `lfResidualActive` (boolean) and
  `lfResidualLastErrPct` before `storePrediction` (5c runs before the stamping block,
  as 5b already does). `storeValidationPair` and the `validation_failure` insert carry
  both fields from the pending row (`?? null`, legacy-safe) — same additive pattern as
  the v37.13 `efDivergence` stamps. Ordering note: step 4 runs before 5c, so a pair
  validated this cycle updates the state BEFORE the new prediction is stamped —
  matching the backtest, where the state at predTs includes all pairs with
  valTs ≤ predTs.
- State row `(observation_type='lf_residual', gauge_id='state')` is upsert-only, stable
  identity — the DELETE-not-UPDATE rule for prediction rows does not apply (same
  confirmed reasoning as v37.13 F3). Episode rows are insert-only with
  `gauge_id = episode.startedAt` (F9: unlike the sibling's `${Date.now()}`, this
  self-dedups if two overlapping runs both observe the same deactivation — the second
  insert collides with the unique key and is dropped, non-fatally).

## 2. API — `sync-learning.js` GET

Payload gains `lfResidual: { active, lastErrPct, activeSince, updatedAt }` (null when
the row is absent) — a 7th entry in the existing parallel SELECT batch, errors
tolerated exactly like the `efDivergence` entry. Samples/episode internals are NOT
shipped (client renders state, never computes).

## 3. Client — display only

- `src/model/constants.js`: `LF_RESIDUAL_STALE_MS = 2h` (mirrors the server's
  clientStaleMs; cross-ref comment).
- New pure helper `src/ui/residual-advisory.js`:
  `shouldShowResidualAdvisory(lfResidual, nowMs)` — active AND `0 ≤ now − updatedAt ≤
  stale` (fail-safe: stale cron shows nothing). Confidence downgrade REUSES
  `downgradeConfidence` from `divergence-advisory.js` (no duplicate).
- `src/ui/great-falls-ui.js`: renders a second amber advisory div
  (`#gf-residual-advisory` + title/body ids, hidden by default, `role=status`,
  same pattern as `#gf-divergence-advisory`) and applies the downgrade at render time.
- **Stacking (both advisories active):** both banners show and the confidence drops one
  notch PER active signal (high→low when both fire). Declared intended, consistent with
  the v37.13 F17 precedent — they are different observables (cross-check disagreement
  vs realized scoring), and their coincidence is genuinely stronger evidence.
- Learning payload already refreshes on the 15-min cycle (v37.13 F8) — no change.

**Advisory copy** (no stats sentence, per the user's v37.14 direction; evidence lives
here in §0 and in the tech appendix):

> **⚠️ Recent estimates ran low — treat this one with extra caution.**
> Recently, this model's estimates have come in well below what the downstream check
> gauge at Little Falls later measured. That often means rain-swollen local streams
> are adding water the upstream gauges can't see. The current number may be low too.
> If the river looks higher than the number, believe the river.

(F7a/b: "Recently" not "Over the past few hours" — the banner can latch off a single
validation and persist up to 12h of signal staleness; "often" not "usually" — the
backtest measured degradation, not cause attribution, and corrupt-LF is an
acknowledged alternative cause.)

("may be low too" is calibrated: 47% of banner-up predictions scored ≥10% low in the
backtest; the copy claims possibility, not certainty, and never claims the model is
usually wrong.)

## 4. Tests (target: 706 → ~730)

- Pure updater: latch ON at ≤−15 / hold in deadband / clear at >−7.5; multiple pairs in
  one cycle applied in order; staleness suppression at >12h AND latch survival (deadband
  pair after gap resumes active); activeSince resets across suppression; episode
  accumulation (worst/mean/trail/LF range), emission-shape on deactivate; empty-pairs
  cycles decay correctly; malformed prevState tolerated. (~9)
- `validatePendingPredictions` returns pairs on both the regular and hard-flag paths. (2)
- Handler 5c non-fatal: rejected upsert + throwing client don't break the cron. (2)
- Stamps present on validation-history entries and `validation_failure` rows; legacy
  rows null-safe. (2)
- GET payload includes `lfResidual`; absent row → null. (2)
- Client helper: active+fresh → show; stale → nothing; inactive → nothing; downgrade
  stacking with the EF advisory (high + both active → low). (4)
- F8 additions: (1) units-trap regression — `errPct: -0.15` (a FRACTION) must NOT
  latch; (2) 5c runs with empty pairs when step 4 returned bare `0` / was skipped;
  (3) client `LF_RESIDUAL_STALE_MS` === server `LF_RESIDUAL.clientStaleMs` equality
  test (retrofit the same for the EF pair, which lacks it); (4) a positive-errPct
  hard-flagged pair clears the latch (documents F4's accepted behavior); (5)
  reactivation after a full clear starts a FRESH episode (startedAt/worstErrPct/
  pairCount reset); (6) episode trail cap 336 + overflow counter; (7) future-dated
  `updatedAt` hides the banner; (8) `lastPairAt`/`lastErrPct` survive empty-pairs
  cycles unchanged; (9) F2 skip-guard: no-pairs cycle + state fresher than runStartMs
  → no write. (~9)
- Existing 706 stay green (no estimate/learning surface touched; parity untouched).

## 5. Docs & versioning

v37.15 (MINOR): CLAUDE.md (version refs + a "LF-Residual Advisory" bullet under Model
Mechanisms, cross-ref this plan) · README version spots + history row ·
`src/assets/CHANGELOG.md` row · `src/assets/tech-appendix.md`: the sibling paragraph
goes INSIDE §5.9 (Confidence Indicator, where the EF advisory text lives) — §5.10
already exists (Uncertainty Display), do NOT renumber (F6) — + "Current
version"/footer · `index.html` title. TODO.md: new entry under done. Commit both
backtest scripts (Python + R); results CSVs stay gitignored (regenerable).

## 6. Verification path (stated upfront)

1. Blind R replication of the backtest arithmetic matches Python <0.01 — **DONE
   2026-07-23** (worst delta 0.005 across all metrics incl. the F1 additions; §0).
2. `npm test` green (~725).
3. Fresh-subagent implementation re-audit (goal + diff only).
4. Push (needs explicit user approval) → Netlify test gate → deploy.
5. Live, time-gated: next cron cycle's GET must include `lfResidual` non-null. The
   advisory itself fires only after the next ≤−15% validation — cannot be forced;
   flagged as an unverified-until-event gap.
6. In-browser banner check: manual (Seb), like v37.10–14.

## 7. Risks / edge cases (for the auditor)

- Corrupt-LF hard flag false-triggering the banner (accepted + mitigated, §1).
- Both-banners UX: two amber boxes stacked — acceptable (rare coincidence, ~real
  compound evidence); auditor may propose a combined rendering but scope creep is
  worse than stacking.
- `errorPercentCorrected` is in PERCENT units (−15 not −0.15) — constants and tests
  must match (the backtest used fractions; conversion is ×100).
- Multi-pair cycles cannot actually occur (F5: single-pending by construction), but
  the pure function still sorts `pairs` by `at` internally and the tests cover the
  multi-pair case as defensive coverage.
- The 12h signalStaleMs vs 2.5h validation-cap: validations stop quickly in outages, so
  staleness is the main OFF path in gaps — intended (fail-closed).
- DB growth: one upserted state row + one episode row per completed firing (~duty
  4.9%, episodes are multi-hour → a few rows/month at most).
- Client bundle: new module mirrors `divergence-advisory.js`; no new dependencies.

## 8. Plan-audit resolutions (2026-07-23, independent auditor — 10 findings, ALL ACCEPTED)

**F1 BLOCKER** harm-coverage + truthfulness were R-only → Python script extended (with
counts), re-run, <0.005 agreement; §0 provenance corrected · **F2 MAJOR** concurrent-cron
latch clobber → 5c reads immediately before write + no-pair-write skip-guard when the
state is fresher than runStartMs; residual races accepted like sibling F14 · **F3
MAJOR** bare-`0` early returns are pinned by tests → kept; handler reads
`validationResult.pairs || []`; "additive" claim corrected · **F4** false-CLEAR
direction (positive-errPct corruption flags, frazil ice) documented as accepted;
DB-fact claims verified live 2026-07-22 · **F5** multi-pair rationale corrected
(single-pending → ≤1 pair/cycle); pure function sorts internally · **F6** tech-appendix
paragraph goes inside §5.9; §5.10 exists, no renumbering · **F7** copy: "Recently" /
"often"; 07-22 row labeled threshold arithmetic; winter-duty wording corrected ·
**F8** nine named tests added to §4 · **F9** episode gauge_id = `episode.startedAt`
(self-dedup) · **F10** R2-vs-R4 tradeoff put on the record in §0.

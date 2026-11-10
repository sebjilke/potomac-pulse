# Plan: show when the 120% cap is binding (audit item A4a, v39.3)

Status: FINAL specification (revised after the independent plan audit, all 13 findings accepted; see "Audit response" at the end).
Source: analysis/pulse-audit-2026-10/REPORT.md, problem 4. Mechanism map and evidence: analysis/cap-mechanism-map-2026-11-10.md.
Version: v39.3, MINOR (display only, estimate unchanged, see Versioning Rules).

## 1. Goal and limits

- When the cap binds on the number on screen, the visitor is told plainly.
- The estimate, the cap, the learning and the server do not change. Nothing under netlify/functions/, src/model/ or the learning code is touched.
- In src/estimation/great-falls.js only additive output fields are allowed. No existing value changes.
- No new dependencies. No new network calls. No database writes.
- No existing test file is modified.
- A4b (keeping capped rows out of learning) is a separate owner decision. Not in this plan.

## 2. What exists today (verified in code)

- The cap is applied once, in `applyGFCorrection` (src/model/shared-model.js:182-197, server twin netlify/functions/shared/model.js:705-721). It cuts the corrected value to 1.2 x the latest Little Falls (LF) reading. The test is a strict `corrected > 1.2 x LF`.
- The browser already has the flag: `inputs.ceilingApplied`. Nothing reads it.
- The helper returns `correctedFinalUnclipped` but great-falls.js drops it.
- The server records the same facts: pending `ceilingApplied`, `lfCFS`, `rawFinalCFS`; tick_log `ceil {lim, bound}` and `corr.unc`; validation_log `ceilBound`.
- Client and server share one helper and are held together by test/correction-parity.test.mjs and test/ensemble-parity.test.mjs.
- The stage in feet is computed from the capped cfs, so the ft number is held too.
- If LF is missing, the browser shows no estimate at all (great-falls.js returns null when `!lf?.q`). There is no state where the cap is silently off.
- If LF or PoR is ice-affected, the browser shows the EF-only estimate. That path never applies the cap and returns no `ceilingApplied`. The note stays hidden there, correctly.

## 3. Design

Option A, chosen: a quiet note inside the estimate card (no box, small type), plus one row in the inputs panel.
- Option B (a full advisory box) is rejected: the card already carries two advisory boxes, and a third would be noise.
- Option C (inputs row and How It Works only) is rejected: most visitors never open the inputs panel, so the page would still not say it.
- Alarm fatigue applies if the note shows on many rising hours. Quiet styling is the mitigation. No rate is claimed in this plan.

## 4. Files and changes

1. NEW src/ui/cap-indicator.js. Pure, no DOM, no top-level window.
   - `describeCap({ shownCFS, uncappedCFS, ceilingLimitCFS, lfCFS, lfReadMs, nowMs })`: for a bound cap returns `{ kind, headline, detail }`, with kind `cut`, `unknown` or `tie`.
   - `capView(estimate, nowMs)`: returns `{ noteHidden, headline, detail, rowText, ciSuffix }` for every case: no estimate, EF-only, not bound, bound.
   - `applyCapView(view, els)`: assigns `hidden` and `textContent` on plain element-like objects `{ note, headline, detail, row, ci }`. Takes the elements as arguments, so tests call it with plain objects.
   - Exports the wording constants so tests pin them.
   - It trusts `ceilingApplied` and never recomputes the cap.
2. src/estimation/great-falls.js (load-bearing path, protocol applies). Additive only, in the `inputs` object next to `ceilingApplied`:
   - `uncappedCFS: Math.round(correctedFinalUnclipped)` (destructure it from the helper result).
   - `ceilingLimitCFS: Math.round(lf.q * CEILING_RATIO)` (import `CEILING_RATIO` from constants).
   - `lfCFS: Math.round(lf.q)`.
   - `lfReadMs: lf.readTime ?? null` (set by src/data/fetch.js).
   - No change to `cfs`, `stage`, the band, or any input to them.
3. src/ui/great-falls-ui.js. Call `applyCapView(capView(...), els)` in all four places:
   - loading branch: note hidden, row `--`;
   - no-estimate branch: note hidden, row `--`;
   - EF-only branch: note hidden, row `N/A (EF only)`;
   - main branch: after the confidence block and after the 90% CI text is written, so the CI suffix can be appended.
4. index.html. Inside `#gf-estimate-display`, directly under the cfs/ft row and before `#gf-ci-range`: `<div id="gf-cap-note" hidden>` with two child divs for headline and detail. No `role` and no `aria-live` on it (the parent is already a polite atomic live region, a nested one can announce twice). One inputs row `#gf-input-ceiling` labelled "120% ceiling", placed after the 90% CI row. Update the title (line 6) to v39.3. Replace the How It Works sentence about the cap.
5. Not changed: shared-model.js, shared/model.js, constants, scheduled-update.js, sync-learning.js, the service worker, any database row, learning-ui.js (the dashboard tooltip is dropped).
   - `SERVER_VERSION` stays 'v39.2'. The server is untouched. Log rows say v39.2 while the site says v39.3. This is intended and is said in the CHANGELOG row.
6. Docs: see section 8.

## 5. Wording (final)

State "cut" (bound, figures complete). Small amber text, two parts.
- Headline: `Capped: the model reads higher than this.`
- Detail: `The model estimates 14,300 cfs. The cfs and ft shown are held at 13,200 cfs, which is 120% of the latest Little Falls reading (11,000 cfs at 14:40). The real flow may be above the number shown, especially on a rising river, where Little Falls responds later.`
- If the Little Falls reading is in the `old` or `stale` band of src/ui/data-freshness.js (bandFor, 180 min and up), add: ` That Little Falls reading is over 3 h old.`
- The reading time is an absolute clock time (24 hour, local time, for example 14:40, the same format as the header label). If the reading was on an earlier calendar day it carries a short date (for example Nov 9, 23:50). If the time is unknown the clause `at ...` is left out.

State "unknown" (flag true, but a figure is missing, not finite, or inconsistent). No figure is invented.
- Same headline.
- Detail: `The model estimates a higher value. The cfs and ft shown are held at 120% of the latest Little Falls reading. The real flow may be above the number shown, especially on a rising river, where Little Falls responds later.`

State "tie" (flag true, but the model value equals the shown value after rounding, so the cap moved the number by under 1 cfs). The card note is hidden. This is "binding but not material". The inputs row still says so.

Inputs row `120% ceiling`:
- cut: `Active (model said 14,300 cfs)`
- unknown: `Active`
- tie: `Active (changed it by under 1 cfs)`
- not bound: `Not active`
- loading or no estimate: `--`
- EF-only: `N/A (EF only)` (the neighbouring rows say "N/A — EF only"; the dash is dropped here by the no em-dash rule)

90% CI row: when the flag is true (any bound state), the text gets the suffix ` (around the capped value)`. The band computation is untouched.

How It Works: `The estimate is also capped at 120% of the latest Little Falls reading. When the cap is holding the number down, the Great Falls card says so and shows what the model itself estimated.`

Rules for the words:
- Never "upper limit" and never anything implying the river is at most the number shown. The cap limits the display, not the river. In October the real flow sat above the capped number in several cap-bound hours.
- "The model's value" means the value after the learned correction and before the cap (the server's `corr.unc`).
- The note says the model reads higher and that the real flow may be above the number shown. It does not claim the model is right.

## 6. Consistency with what the server recorded

- Same definition: the flag comes from the same shared helper, so "bound" means `corrected > 1.2 x LF` on both sides.
- Field map: server `ceilingApplied`, `lfCFS`, `ceil.lim`, `corr.unc` correspond to `ceilingApplied`, `lfCFS`, `ceilingLimitCFS`, `uncappedCFS`.
- The note describes the number on this screen. The server's logged value can differ (the two flow-state classifiers differ on sparse history, and the inputs can be up to an hour apart). The server flags its own binding as `ceilBound` in validation_log.
- The 90% CI stays centred on the displayed (possibly capped) number. It is marked, not changed.
- The forecast graph history still stores capped values. Not marked. Follow-up.

## 7. Tests

New test/cap-indicator.test.mjs (node --test). All expected strings are hard-coded, not rebuilt from the code under test. Local times are built with `new Date(y, m, d, h, min)` so results do not depend on the time zone (the suite is run with `TZ=UTC` too).

1. End-to-end bound fixture (PA-2). Real client estimator and real server predictor via `loadEstimators()`, inputs por 13000, lf 9000, lfH 3.6, other inputs as the "elevated" ensemble fixture, dense steady PoR history, LF `readTime` set. Pass a `trace` object to `makeGFPrediction`.
   - First assert `inputs.ceilingApplied === true` (guards against a vacuous test) and the server's `ceilingApplied === true`.
   - Then `inputs.uncappedCFS === Math.round(trace.unc)`, `inputs.ceilingLimitCFS === Math.round(trace.ceilLim)`, `inputs.lfCFS` equals the server's `lfCFS`, `cfs === ceilingLimitCFS`, and `uncappedCFS > cfs`.
   - Hard-coded: cfs 10800, uncappedCFS about 11999 (exact value from the run).
   - `capView` on that real estimate gives a visible note whose detail holds the model value, the shown value and the LF value.
   - One unbound fixture: `capView` hides the note and the row says `Not active`.
2. Wording (PA-1). The detail and headline never contain "upper limit" (case-insensitive), and the detail contains "may be above the number shown". The detail says "cfs and ft".
3. Clock time (PA-3). A reading at local 14:40 shows "at 14:40". An earlier-day reading shows a date. A null read time omits the clause. Reading 179 minutes old has no "over 3 h" clause. 180 minutes old has it. The test imports `OLD_MIN` from data-freshness.js to place the boundary and also hard-codes 180.
4. Rounding (PA-7). With the real helper: corrected exactly 1.2 x LF gives flag false and no note. Just above (+0.4) gives kind `tie`: note hidden, row `Active (changed it by under 1 cfs)`. Above by 1 or more gives kind `cut` with figures. A non-integer LF (11003.5) gives a limit that matches 120% of the stated LF value within 1 cfs.
5. Missing inputs (PA-7). Flag true with any of the figures missing or not finite gives kind `unknown`: no digits other than "120" in the detail, and the row is `Active`. Inconsistent figures (uncapped below shown) also give `unknown`.
6. Reset in every branch (PA-4). `capView(null)` and `capView({ efOnly: true, ... })` hide the note and give rows `--` and `N/A (EF only)`. A real EF-only estimate (LF ice-affected, run through the real estimator) gives a hidden note (PA-10).
7. Wiring through real assignments (PA-8). `applyCapView` is called with plain objects standing in for elements. After a bound view the note is visible and holds the text. After a following null view the note is hidden and the row is `--` (no stale state). The CI text gets the suffix only when bound and not when `--`.
8. Wiring in the UI file. The body of `updateGreatFallsUI` is split at each bare `return;`. Every segment that ends in a `return;` must call `applyCapView`, and the final path must too. A test that the elements `gf-cap-note` and `gf-input-ceiling` exist in index.html and that the note has no `role` or `aria-live`. This is a source check and is labelled as such. It is a guard, not the behaviour test.
9. No estimate change: the characterization, parity, uncertainty-band and golden tests stay green and unmodified.

Revert check, recorded in the final report: run each mutation (indicator returns null, new fields dropped, "may be above" replaced by "upper limit", inputs row not reset, CI marking removed) in a scratch copy and confirm a test fails. Stubbing the indicator to null makes tests 1, 3, 4, 5 and 7 fail. Test 6 passes for the null cases by design.

## 8. Side effects and doc impact

Side effects:
- A new small block appears on the card whenever the cap binds materially. It can be frequent during a rise.
- Layout: one more block inside the card. Small-phone wrapping is unchecked (about 230 characters, 4 to 5 lines on a narrow phone).
- The note and the residual advisory can show together. Intended.
- Screen readers: the card is already a polite atomic live region, so a changed note re-reads the card. Not verified.
- The cap can stop binding after a correction changes. Then the note disappears and the number drops. That is correct, and it is a reason to watch the A4b question.

Docs to update (Versioning Rules):
- CLAUDE.md: version line; line 157 "Soft LF Ceiling" wording changed from "LF actual" to "the latest Little Falls reading (typically 10 to 70 min old)", plus a line on the indicator.
- README.md: current version, "Current Model" heading, test count, version table row, last-updated line, and the two "LF actual" phrases.
- src/assets/CHANGELOG.md: v39.3 row (MINOR, display only, server left at v39.2).
- src/assets/tech-appendix.md: section 5.6 reworded ("the latest Little Falls reading, typically 10 to 70 min old", no "LF actual discharge"), one sentence that the card marks the cap and shows the pre-cap value, the ice case has no cap, with LF missing the browser shows no estimate, and the note describes this screen's number while the server's logged value can differ. Section 5.10 (CI): the band is centred on the displayed, possibly capped, value. Version history, current-version line, Generated-by footer.
- index.html: title and How It Works.
- TODO.md: header version and test count, A4 row split into A4a (done) and A4b (open, owner decision), Recently completed.
- analysis/pulse-audit-2026-10/REPORT.md: dated correction under problem 4 and in the order-of-work table (A4b finding).
- analysis/cap-mechanism-map-2026-11-10.md: copy of the evidence.

## 9. Verification path

1. Independent audit of the plan: done (13 findings, all accepted).
2. Implement. `npm test`, `TZ=UTC npm test`, `npm run build`.
3. Mutation runs in a scratch copy (section 7).
4. A fresh Opus verifier gets the goal and the diff only.
5. After deploy: confirm the built bundle contains `gf-cap-note`. A live example needs a fast rise and cannot be forced.

## 10. Cannot be verified without a real browser

- That the note renders, wraps and reads correctly on a phone, in light and dark themes.
- That it appears together with the number on a live cap-bound refresh and clears when the cap stops binding.
- That the note and the row clear when the estimate switches to EF-only during ice.
- That the clock time matches the v39.1 header label.
- That the service worker serves the new bundle after deploy.
- Screen reader behaviour of the changed live region.
- That the wording is understood by paddlers. Needs the owner's eye.
- A live example of a bound estimate. Unit tests use fixtures.

## 11. Decisions for the owner

1. Wording in section 5.
2. `SERVER_VERSION` left at v39.2 (recommended).

## Audit response

Auditor verdict was approve_with_changes. All 13 findings are ACCEPTED.

- PA-1 ACCEPTED: "upper limit" removed. Wording now says the model reads higher, the display is held at 120% of the latest Little Falls reading, and the real flow may be above the number shown. A test pins both.
- PA-2 ACCEPTED: test 1 uses a real bound fixture (por 13000, lf 9000), asserts `ceilingApplied === true` first, then the new fields against the model's own `trace.unc` and `trace.ceilLim`.
- PA-3 ACCEPTED: the frozen relative age is gone. The note uses the absolute clock time of the Little Falls reading, with a clause based on the existing `bandFor` bands. No 60 minute threshold.
- PA-4 ACCEPTED: the inputs row is reset by `applyCapView` in the loading, no-estimate and EF-only branches. A test checks every early return.
- PA-5 ACCEPTED: the detail says "the cfs and ft shown are held". A test asserts it.
- PA-6 ACCEPTED: when bound, the 90% CI row gets the suffix "(around the capped value)".
- PA-7 ACCEPTED: a rounding tie is its own state (note hidden, row says so), separate from missing inputs. Tests at exactly 120%, just above, one above, and a non-integer LF.
- PA-8 ACCEPTED: the revert claim is corrected. Wiring is tested through the pure `capView` and `applyCapView` on plain objects. The source check is a labelled extra guard. Mutation runs are recorded.
- PA-9 ACCEPTED: tech appendix 5.6 and 5.10, CLAUDE.md and README "LF actual" wording corrected, indicator sentence added.
- PA-10 ACCEPTED: the plan and docs now say that with LF missing the browser shows no estimate, and the ice case has no cap. A test covers the EF-only estimate.
- PA-11 ACCEPTED: no `role` and no `aria-live` on the note. Screen reader behaviour listed as unverified.
- PA-12 ACCEPTED: dashboard tooltip dropped, `tag` and `excessCFS` dropped, the unsourced "62 of 72 hours" figure removed.
- PA-13 ACCEPTED: one sentence added to the plan (section 6) and the tech appendix that the note describes this screen's number and the server's logged value can differ.

## Post-review amendments

Added after an independent re-audit of the implemented change. Final note text (both variants end with the same sentence): "The real flow may be above the number shown, especially on a rising river, where Little Falls responds later."

1. Wording. The old last sentence ("Little Falls lags a rising river, so ...") read as a cause, but the cap also binds on steady and falling rivers. Replaced, in the full and the no-numbers variant, with the sentence above. "upper limit" still never appears. Tests pin the exact sentence and that "may be above the number shown" stays.
2. Test gap. The "(around the capped value)" mark used to be appended to the 90% CI row after the fact, so moving the cap render above the CI line lost it silently. Now `ciRowText(baseText, view)` in `cap-indicator.js` is a pure function and the page writes the CI row once with it; `applyCapView` no longer touches that row. Tested on the result, not the source order. Mutation proofs in the scratch copy: `ciRowText` returning the base text fails the unit test; the page writing the CI row without `ciRowText` fails the wiring test.
3. Stale note. The cap note is now rendered immediately after the big number is written (previously about 140 lines later), in one place for the EF-only and normal paths; the two early-return branches still clear it. No other behaviour changed. A source-order test asserts nothing sits between the number write and the render; moving the render late fails it. A behavioural test of a mid-function throw is not possible without a DOM harness for this module.
4. Formats. The note formats numbers with `toLocaleString()` (the call used for the big number) and the clock with the header label's `clock()` from `data-freshness.js` (now exported): 24 hour, local time. Tests run under UTC and America/New_York; a test sets `process.env.TZ` to America/New_York, Asia/Kolkata and UTC at run time and checks the local clock, so a UTC-based clock fails whichever zone the suite runs in.
5. Docs. CLAUDE.md now says "typically 10 to 70 min old". README, CHANGELOG, Tech Appendix and this plan quote the new wording and 24 hour clock. Test counts: 42 tests in `test/cap-indicator.test.mjs`, 1075 in the suite. Follow-ups logged in TODO.md under A4 (map popup and dashboard unmarked, "over 3 h old" clause refreshed only on the 15 minute render, atomic live region re-reads the note, 0.6rem type).

# v39.8 plan: independent plan audit (2026-11-12)

Auditor: a fresh subagent that did not write the plan. Text as returned, saved by the orchestrator. No code had been changed.

## Verdict: approve_with_changes

The plan is careful, and most of its anchors hold. Fix these three things before implementation:

1. **The EF advisory loses its direction-of-error clause.** "water this estimate may not fully see" is cut (PA-1). The owner asked for no warning to be removed.
2. **The guard against missed writes to deleted elements cannot catch the plan's own riskiest deletion** (PA-2). It only matches chained `getElementById("x").` calls. `#status` is written through a variable (`st.textContent`), so a missed write there would pass the guard.
3. **Two tests and one rounding rule cannot catch what the plan says they catch.** The creeks "throwing localStorage" test is swallowed by the code's own try/catch (PA-3). The tooltip rounding, as written, makes the Now card and its tooltip disagree (PA-4).

Baseline confirmed: `npm test` gives 1297 tests, 1295 pass, 2 skipped, 0 fail.

## Findings

**PA-1 (must-fix). The EF line drops the only phrase that says the number may be low.**
- Evidence: `divergence-advisory.js:48-49` says "it can mean water is entering the Potomac below those gauges, water this estimate may not fully see." Plan B3 replaces this with "That can be gauge noise at low water, or water entering below those gauges."
- The residual line keeps "The current number may be low too." The EF line ends up with no stated direction.
- The closing sentence does not show in every case where the EF line shows a direction on its own. A visitor has to infer that "water entering below those gauges" means the estimate is low.
- B3 also claims "No new sentence is invented. Every sentence above exists today." That is loose: both sentences of the EF line are reworded.
- Change: end the EF line with "... or water entering below those gauges, water this estimate may not fully see."
- Change: correct the B3 claim to "reworded from existing sentences".
- Add a test that `DIVERGENCE_LINE` matches `/may not fully see/`.

**PA-2 (must-fix). Widen the C2 null-safety guard.**
- Evidence: `fetch.js:597` has `const st = document.getElementById("status");`, then `st.textContent = ...` at 616, 620, 625, 629 and 634.
- Other unguarded variable writes: `great-falls-ui.js:63` (`labelEl`), `316-317` (`efCrosscheck`, `efEstimateEl`) and `forecast-graph.js` (`tooltip`).
- A chained-only regex misses all of these. The fake DOM (`el(id)` creates any id) also misses them.
- Change: collect every static string id passed to `getElementById` in all of `src/**/*.js`, whatever the access form. Require each one to exist as `id="X"` in `index.html`, with an explicit allowlist of ids created at run time.
- I ran this check. Of 136 static ids, only 8 are not in `index.html`: `gf-popup-cfs`, `gf-popup-stage`, `gauge-search`, `gf-graph-hover`, `gf-graph-marker`, `gf-marker-dot`, `gf-marker-line`, `valChartHover`. So the allowlist is small.
- Revert check: delete `<span id="status">` but keep one `st.textContent` write. The test must fail.

**PA-3 (should-fix). The creeks test cannot fail.**
- Evidence: `creeks-ui.js:259-280` and `308-325` both wrap `localStorage.getItem` in `try { } catch(e) {}`.
- A `localStorage` that throws is caught. The card writes `''` and the test passes even if the read is put back. So the C3 revert check ("the throwing stub fails the test") is false.
- Change: use a recording stub (`getItem` pushes to an array) and assert zero calls. Keep the source guard on `creek_lastran`/`lastRan`.
- Also edit `test/creek-level.test.mjs:115` (`assert.notEqual(v.lastRan, 'now')`). The plan's edit list (297-323, 366, 380) misses it.

**PA-4 (should-fix). Tooltip rounding must exclude the Now and history points.**
- Evidence: `showGraphMarker(0)` runs when the Now card is tapped. `fgData.find(d => d.hrs === hrs)` returns the first `hrs: 0` point, which is the pushed "now" history point. Its cfs and stage are exact (`great-falls-ui.js:642-649`).
- `forecast-graph.js:278-282` formats history points the same way.
- If every tooltip is rounded, the Now card (exact) and its tooltip (rounded) disagree. That breaks the plan's own goal.
- Change: round only when `!d.isHistory && d.hrs > 0`, in both `great-falls-ui.js:717-718` and `forecast-graph.js:281-282`.
- Test: after `showGraphMarker(0)` the tooltip equals the Now card text. After `showGraphMarker(6)` it equals the +6h card text.

**PA-5 (should-fix). Mixed precision makes the trend arrow contradict the numbers.**
- Evidence: `great-falls-ui.js:604`: `p.cfs > currentCFS ? '▲'`.
- Example: Now shows "10,812 cfs / 6.43 ft". +6h at 10,830 shows "10,800 cfs / 6.4 ft ▲". The arrow says up, but both displayed numbers are lower.
- The plan's C1 only mentions the "equal" case. The "lower but ▲" case is worse.
- Change (display only): show ● when the rounded card value equals Now rounded by the same rule. Otherwise compare the raw values as today. Add a test for this exact example.

**PA-6 (should-fix). Dropping "(LF scale)" from cfs rests on a false premise.**
- Evidence: plan A1 says "a flow in cfs has no gauge scale. It is a flow estimate for Great Falls."
- `tech-appendix.md` §6.1 (around line 405) says: "The number the app calls 'Great Falls flow' is therefore structurally 'Little Falls discharge, one GF→LF travel time ahead.'"
- `CLAUDE.md:166` calls the band "an LF-equivalent-flow band".
- The difference is small: -10 to +70 cfs. But the label is a true disclosure, not jargon.
- Change: correct the rationale. Then pick one:
  - (a) Accept the drop knowingly, citing the appendix's "precision in description, not of accuracy".
  - (b) One caption under both numbers: "Little Falls gauge terms".
- Put this to the owner as a one-line decision.

**PA-7 (should-fix). "Flow range" can be read as an uncertainty range.**
- Evidence: the panel row sits two rows above "90% CI", which is also a range. The value is a learning bin such as `6000-12000`, with no unit.
- When capped, it is the bin of the raw unclipped value. For example, the number shows 11,900 while the row says 12000-25000 (pinned in `confidence-parity.test.mjs:144-150`).
- Change: use "Flow band" (the CX review's own word, `cx-review:128`) or "Flow band used for learning". Keep "(12 checks)".

**PA-8 (should-fix). The cap row label could read as a limit on the river.**
- Evidence: proposed "Cap at 120% of Little Falls" next to "Active (model said 11,999 cfs)". CLAUDE.md:156 says the cap limits the display, not the river.
- Change: use "Display cap (120% of Little Falls)". It says what is capped.
- Width: label plus "Active (model said 11,999 cfs)" is about 60 characters at 0.6rem in a space-between row about 300 px wide. Add it to section J (phone checks).

**PA-9 (should-fix). "Weather Service" will wrap on most card layouts.**
- Evidence: `.fp-time` holds `+6h` plus the source. `.fp-source` is 0.5rem on desktop and 0.6rem at 768 px or less.
- Desktop with the map open: sidebar 380 px, 5 columns, roughly 55 px of content per card. Phone at 360 px: 3 columns, about 93 px each.
- "+6h Weather Service" does not fit either one, so every future card gains a line.
- Both NWS sources map to one label, and extrapolated applies to every card. So all four cards always show the same word.
- Change: drop the per-card label. Write the source once on the legend line, for example "Source: National Weather Service forecast" or "No NWS forecast: rough trend". The tooltip moves to that line.
- If per-card labels stay, use a short word such as "NWS" or "Trend" and list the wrap in J.

**PA-10 (should-fix). Row 6 adds text that was not asked for, and it wraps.**
- Evidence: "▲▼ vs now • ft are on the Little Falls gauge scale • tap card or graph for details" is about 80 characters at 0.6rem. That is two lines at 360 px.
- The approved item A is replacing jargon, not adding disclosures. The cards use the same ft as the headline, whose label now explains it.
- Change: drop row 6, or ask the owner.

**PA-11 (should-fix). The extrapolated tooltip is not true as written.**
- Evidence: `great-falls-ui.js:581-582`: `dampening = Math.max(0.3, 1 - hrs/72)`.
- The projection moves from the current estimate toward `gfEst.forecastCFS` (current PoR arriving after the travel time). It is dampened, so it is not "a straight-line trend from the current estimate".
- Change: "No National Weather Service forecast available. A rough projection from the current estimate and the upstream reading."

**PA-12 (should-fix). The C1 test should guard forecast storage itself.**
- Evidence: `gf-learning.js:165-170` filters on `p.source.startsWith('NWS')`.
- If an implementer assigns the display label to `p.source`, storage stops silently. The log says "skipped: no NWS-based forecasts" and no test fails.
- The plan's revert check covers stage only. `predictedCFS` is already an integer, so "integer predictedCFS" proves nothing.
- Change: in the bundle test, use a fixture where the period cfs is not a multiple of the display step (for example 10,812). Assert:
  - exactly one POST happens;
  - `source` is `'NWS'` or `'NWS+EF'`;
  - `predictedCFS === 10812` while the card shows "10,800";
  - `predictedStage` equals the unrounded value.

**PA-13 (should-fix). Replace source-text guards with behaviour tests where the harness already allows it.**
- Evidence: `startup-refresh-behaviour.test.mjs` already bundles `updateGreatFallsUI` with a fake DOM and has an ice fixture (`iceBody`) that reaches the EF-only branch.
- Change: add behaviour tests through that harness:
  - The EF-only render writes "❄️ ESTIMATE FROM EDWARDS FERRY ONLY" and "Confidence: LOW (Edwards Ferry only)".
  - With `gfLearningData.efDivergence` and `lfResidual` active and fresh, the `gf-notice-*` slots and the closing slot match the B4 table.
  - A later EF-only render hides the box.
- Keep the B8 source guard only as a backstop. The A5 checks on `great-falls-ui.js` source can go once the behaviour tests exist.

**PA-14 (note). Notice clearing now fails in the opposite direction.**
- Evidence: plan B2 has `renderCapIndicator(gfEstimate)` (line 175) clear the whole box, including advisories. `renderNotice` runs about 80 lines later.
- If anything between them throws, the advisories end up hidden. Today they stay visible. Hidden is the less safe direction.
- The risk is lower after C2 removes the `gf-data-source` writes. State it in I.7.
- Optional: move the two `const divergenceShown/residualShown` lines above the number write. The parity regex pins only `let shownConfidence` and the two `if` lines, and the cap wiring test only pins what sits between the number write and `renderCapIndicator`. Then the main-path clear can use the real flags.

**PA-15 (note). Stale advisories lingered in more states than EF-only. Clearing them is correct.**
- Evidence: every branch that returns early before line 256 (loading at 124, no-estimate/unavailable/ice at 160, EF-only at 208) only hides the cap note. So an earlier advisory box stayed under "UNAVAILABLE" too. Plan B5 lists all three; the orchestrator's summary says only EF-only.
- Clearing is correct in every case:
  - There is no number to caution about, or the number comes from a different model (EF power law).
  - EF-only confidence is a fixed "LOW (EF only)" with no "⚠", so a visible advisory would contradict it.
  - A first load in EF-only never shows them.

**PA-16 (note). The D1 and D2 approaches work.**
- I ran a probe in the scratchpad, not in the repo. Results:
  - Bundling `src/ui/map.js` alone, with a plugin that resolves `leaflet` to a Proxy stub: `initMap()` fetched no outline file, and three `toggleMap()` calls fetched each file once.
  - `import('../src/learning/gf-learning.js?case=N')` gives a separate module instance (separate `inFlight` and `loadGen`). Its `store.js` import stays shared.
- Requirements to write into the plan:
  - Use one entry (`map.js`) so `store.js` is shared. The plan's "bundle map.js and store.js" could be read as two bundles.
  - `document.body.classList.toggle` must be stateful and return the new state.
  - The Proxy must return `undefined` for `then`.
  - In D2, replace the static `import { loadGFLearningData }` with a `let` assigned in `beforeEach`.
- A per-URL `MODULE_TYPELESS_PACKAGE_JSON` warning prints. It is harmless.

**PA-17 (should-fix). Docs and the verification steps are incomplete.**
- `tech-appendix.md:598` quotes "LOW (EF only)". It is not in G.
- `CLAUDE.md` "Deployment & Verification" requires an end-to-end browser check with Chrome MCP for UI changes. H.7 must either do it or record it as an unverified gap. Section J is the right list, but step 7 should name it.
- CLAUDE.md:201 ("second amber banner") is covered by G. Fine.

**PA-18 (note). Wrong or loose anchors and claims.**
- Section 0: the shownConfidence lines are 250-252, not 214-216. The " ⚠" suffix is line 253, not 217. (214-216 matches the v39.6 numbering the CX review used.)
- `renderCapIndicator(null)` is at 124 and 160, not 121 and 158. `renderCapIndicator` is defined at 44-53, not 43-52.
- A1 row 7: "Only when PoR is ice-affected" is wrong. EF-only runs when PoR **or** LF is ice-affected (`great-falls.js:344`).
- A pre-existing out-of-scope bug: the EF-only branch writes `gf-input-por` = "❄️ ice-affected" even when only LF is iced. Log it, don't fix it here.
- A5: `cap-indicator.test.mjs:255` uses the constant `ROW_EF_ONLY`, not a literal. Only 114 and 252 hold literals. Keep one `ciRowText` case on the new "N/A (Edwards Ferry only)" string; the `/^N\/A/` check still matches.

**PA-19 (note). Main-screen jargon the A table missed.**
- `#forecast-accuracy` is visible at 10 or more validations. It shows "Forecast accuracy … (N validations)" and "vs persistence:" (`great-falls-ui.js:764, 790`).
- The graph tooltip labels past points "(observed)" (`forecast-graph.js:276-277`). They are past estimates, not observations, so the label is false.
- Change: list these in A4 as seen and not changed, or ask the owner. Do not widen scope silently.

**PA-20 (note). Wording and layout of the Little Falls labels.**
- "Real gauge below Great Falls" puts down the estimate by contrast. "Measured gauge below Great Falls" is just as plain.
- `.target-sub` is 0.75rem in a flex row next to two 1.2rem numbers, with roughly 150 px free at 360 px. The current text probably already wraps, and the new one (43 characters) will take two lines. Add it to J.
- Row 3: `#multVal` keeps `aria-label="Current travel time from Point of Rocks to Little Falls"`. A screen reader will now hear "Point of Rocks to Little Falls" twice. Shorten the aria-label to "travel time".
- Row 5: "ft on the Little Falls gauge scale" widens the ft column, so the two big numbers lose their symmetry. Add it to J.

**PA-21 (note). The cap note changes look, not only position.**
- It goes from quiet centred amber text under the number (v39.3: "quiet note") to a bordered amber box below the confidence line.
- The "⚠️" glyphs and the amber title colour are dropped, so the lead-ins are no longer easy to scan.
- Show the owner the cap-only case (J already lists forcing it).
- Optional: put each line's lead-in ("Capped:", "Cross-check gauge disagrees:", "Recent estimates ran low:") in its own `textContent` span, styled like the old titles.

## Checked claims

| Claim | Result |
|---|---|
| index.html anchors (58, 69, 73, 87, 119, 123, 128-131, 132, 134, 138-147, 148, 155-158, 177, 207-235, 241-244) | Confirmed |
| `multVal` value from gauges-ui.js:162 | Confirmed |
| great-falls-ui.js 183, 189, 191, 203-205, 611-612, 616-619, 717-718; forecast-graph.js 281-282 | Confirmed |
| shownConfidence lines at 214-216, suffix at 217 | Wrong: 250-252 and 253 |
| renderCapIndicator calls at 121/158, definition 43-52 | Wrong: 124/160, 44-53; 175 is correct |
| Parity test pins only the `let shownConfidence` line plus two `if` lines by regex, and imports `downgradeConfidence` | Confirmed; plan B keeps it valid |
| Cap wiring test: splits on `return;`, needs two `renderCapIndicator(null)` and one `renderCapIndicator(gfEstimate)`, only `const capV =` between number write and render | Confirmed; plan keeps it valid |
| `storeForecastPredictions` posts `predictedCFS: p.cfs, predictedStage: p.stage, source: p.source`, filter `startsWith('NWS')` | Confirmed (gf-learning.js:165-195) |
| `periods[].cfs` rounded, `.stage` unrounded | Confirmed (559-560, 588-589) |
| `data-stage` and `data-cfs` never read | Confirmed (no `dataset.stage` or `dataset.cfs` anywhere) |
| `gf-ci-range` writes 116, 152, 207; `gf-ci-text` none | Confirmed |
| `gf-data-source` writes 114, 145, 148, 185-186, 222-223, 225-226, 231-232 | Confirmed |
| `gf-forecast-*`: 13 writes (117-119, 153-155, 192-194, 275-278); `fmtArrival` used only at 278 | Confirmed |
| `gf-accuracy`: no JS | Confirmed |
| `gf-val-countdown` at 344; `gf-val-last` at learning-ui.js:26 and 40 (guarded) | Confirmed |
| `#status`: fetch.js:597 and five writes at 616/620/625/629/634 | Confirmed; display:none live regions are never announced, so removal is safe |
| No test or CSS references any removed id | Confirmed (grep of test/, src/styles/) |
| No other never-shown elements on the main tab | Confirmed (every hidden or display:none id cross-checked) |
| Advisory strings and their tests (divergence 50-60, residual 66-75) | Confirmed |
| Creek: fetch.js:377-379, creeks-ui.js:31, 241, 259-280, 305-326, creek-level.js:93, 123 | Confirmed (comment at 258); test line 115 missed |
| `.creek-meta span::after` stray dot | Plausible from CSS (shows when the span is empty); not rendered |
| Ice "7-day window" (loop over the whole P7D series) | Confirmed |
| EF-only "only when PoR iced" | Wrong: PoR or LF |
| "cfs has no gauge scale" | Wrong per tech-appendix §6.1 |
| How It Works names none of the changed labels | Confirmed; its cap sentence stays true |
| Docs list in G | Incomplete: tech-appendix:598 |
| Baseline 1297 tests / 2 skips | Confirmed by running `npm test` |

## The four defaults

1. **Short lines: agree, with PA-1 applied.** The cuts are fine except the direction clause in the EF line. Without it, a caution is removed.
2. **Headline and "Now" card stay exact: agree.** Rounding the headline touches the cap note's arithmetic (the 120% figures must match the big number, pinned by `cap-indicator.test.mjs:280-285`) and the CI row. The trend contradiction (PA-5) and the tooltip scope (PA-4) must be handled for this default to be coherent.
3. **Drop "Last ran" and the banner suffix: agree.** The value is false (browser-clock stamp, per device). Deriving it from history needs new text. It is not a warning, so removing it breaks no owner constraint. Fix the test per PA-3.
4. **Leave the ">2 days" ice wording: agree.** It is outside the approved items. It is visible but rare (gauge popups and row titles in ice). Record it as a TODO line so it is not lost. The E edit (comment and console log) is fine.

## What I could not check

- Real rendering and wrapping at 360 px. All width judgments (PA-8, PA-9, PA-10, PA-20) come from the CSS, not a browser.
- Screen-reader behaviour of the new box inside the atomic live region.
- That the C1 bundle test can reach the NWS branch with a hand-built forecast fixture. I checked that the harness bundles `great-falls-ui.js` and that the probe bundles run; I did not write that fixture.
- My D1 and D2 probes ran in the scratchpad only. Nothing in the repo was changed, and no build was run.

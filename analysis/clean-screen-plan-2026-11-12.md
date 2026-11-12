# Plan: v39.8 "clean screen" (client only, display only)

Everything below was checked against the v39.7 source (commit 58fd4d8). I changed no files and ran no tests. Line numbers are v39.7 line numbers.

## 0. Rules for the whole release

- **Does not change:** the estimate, `src/model/*`, `src/estimation/*`, `netlify/*` (`SERVER_VERSION` stays v39.6), `vite.config.js` and `config/runtime-caching.mjs`, `period=P7D`, NWS calls, the localStorage cache write, and the How It Works tab prose.
- **Also unchanged:**
  - The functions that decide when a note shows: `shouldShowDivergenceAdvisory`, `shouldShowResidualAdvisory`, `capView`'s cap conditions, and the `downgradeConfidence` calls.
  - The v39.7 unavailable state and its three reason lines: `REASON_USGS`, `REASON_EF`, `REASON_LF_POR`.
  - The confidence label logic.
- **Hard constraint from `test/confidence-parity.test.mjs`.** It executes the exact source text of these `great-falls-ui.js` lines (v39.7 lines 214-216):
  `let shownConfidence = gfEstimate.confidence;` then `if (divergenceShown) shownConfidence = downgradeConfidence(shownConfidence);` then `if (residualShown) …;`.
  Keep the names `divergenceShown` and `residualShown`, the three lines, and their order, byte for byte. The `" ⚠"` suffix on the confidence text (line 217) also stays.
- **The fake DOM in the tests hides missing-element bugs.** `startup-refresh-behaviour.test.mjs` uses `el(id)`, which creates any id on demand. A deleted element that code still writes to would pass every existing test and throw in a real browser, blanking the card. So the plan adds a static guard test (section C2).

## A. Plain labels

### A1. Complete table (visible = a sighted visitor sees it)

| # | Where | Visible? | Current | Proposed |
|---|---|---|---|---|
| 1 | index.html:73 `.target-sub` | Yes, always | `11,560 sq mi • Target gauge` | `11,560 sq mi • Real gauge below Great Falls` |
| 2 | index.html:69 aria-label on `.target` | Screen readers only | `Target gauge: Little Falls` | `Little Falls gauge, below Great Falls` |
| 3 | index.html:87 `.flow-indicator` | Yes, always | `PoR → LF: ~26 hrs` (value from gauges-ui.js:162) | `Point of Rocks to Little Falls: ~26 hrs` |
| 4 | index.html:119 | Yes | `cfs (LF scale)` | `cfs` |
| 5 | index.html:123 | Yes | `ft (LF scale)` | `ft on the Little Falls gauge scale` |
| 6 | index.html:177 legend line under the cards | Yes | `▲▼ vs now • tap card or graph for details` | `▲▼ vs now • ft are on the Little Falls gauge scale • tap card or graph for details` |
| 7 | great-falls-ui.js:183 | Only when PoR is ice-affected | `❄️ EF-ONLY ESTIMATE` | `❄️ ESTIMATE FROM EDWARDS FERRY ONLY` |
| 8 | great-falls-ui.js:189 | Same case | `▲ RISING (EF trend)` | `▲ RISING (Edwards Ferry trend)` |
| 9 | great-falls-ui.js:191 | Same case | `Confidence: LOW (EF only)` | `Confidence: LOW (Edwards Ferry only)` |
| 10 | great-falls-ui.js:203-205 (panel) | Panel open, same case | `N/A — EF only` (x3) | `N/A (Edwards Ferry only)` |
| 11 | cap-indicator.js:19 `ROW_EF_ONLY` (panel row) | Panel open, same case | `N/A (EF only)` | `N/A (Edwards Ferry only)` |
| 12 | index.html:207 (panel) | Panel open | `Travel time PoR→GF` | `Travel time, Point of Rocks to Great Falls` |
| 13 | index.html:211 (panel) | Panel open | `Travel time GF→LF` | `Travel time, Great Falls to Little Falls` |
| 14 | index.html:215 and great-falls-ui.js (`${binCount} obs`) | Panel open | `Flow bin` and `6000-12000 (12 obs)` | `Flow range` and `6000-12000 (12 checks)` |
| 15 | index.html:219 | Panel open | `Learned correction` | `Adjustment learned from past errors` |
| 16 | index.html:227 | Panel open | `120% ceiling` | `Cap at 120% of Little Falls` |
| 17 | index.html:232 | Panel open, only when an EF estimate exists | `EF Cross-check` | `Edwards Ferry check` |
| 18 | index.html:235 | Same | `Edwards Ferry power-law estimate` | `Estimate from the Edwards Ferry gauge alone` |
| 19 | great-falls-ui.js:612 (`p.source` text on forecast cards) | Yes | `NWS`, `NWS+EF`, `extrapolated` | `Weather Service`, `Weather Service`, `Trend only` (see C1) |
| 20 | great-falls-ui.js:611 (card tooltip) | Hover only | `NWS upstream forecast (arrival time varies with flow)`, used for every source, including `extrapolated`, where it is false | Per source (see C1) |

Why the `ft` wording is true: `estimateLFStage(cfs)` maps the flow through the Little Falls rating curve. Row 4 drops "(LF scale)" from the cfs label because a flow in cfs has no gauge scale. It is a flow estimate for Great Falls.

Row 6 puts the same disclosure on the forecast cards, which also show `ft` on the Little Falls scale. It adds words to an existing line and adds no element.

### A2. Kept, with reason

- **`90% CI` (index.html:223).** Kept. TODO A8 is open: the real coverage of the shown band is under review (CX review F11 says about 49%). Plainer wording such as "9 in 10" would make an unverified claim louder.
- **`Estimation Inputs`, `Confidence: HIGH/MEDIUM/LOW`, `ESTIMATED NOW`, `FORECAST (no history yet)`, `cfs`, `ft`, `sq mi`.** Already plain.
- **Gauge and place names.** Point of Rocks, Monocacy, Goose Creek and the rest are place names.
- **`No USGS gauge` (the line under "Great Falls").** USGS gauges are standard vocabulary for paddlers.
- **`*Experimental — collecting data to validate accuracy` (index.html:162).** An existing caution. Not touched.
- **The three v39.7 reason lines.** Kept as instructed. They still contain "USGS", "Edwards Ferry", "Little Falls or Point of Rocks".
- **`ESTIMATED NOW`.** CX F3 wants an age here. That is TODO S4, not this release.

### A3. Hidden text that holds jargon (no label change, removed in C2)

`#gf-data-source` ("83% PoR … [Δ-corrected 12%] + 17% EF → LF"), `#gf-forecast-*`, `#gf-ci-range`.

### A4. Seen and not changed (outside the approved scope)

- Map popup "Ensemble blend: PoR + EF models" and the legend text "Little Falls (Target)" (map.js).
- Creeks "🔗 AW" and "micro-run".
- `Ice-affected >2 days` strings (gauges-ui.js:176, popup). `iceLongTerm` is set only when the 7-day series has no valid reading, so ">2 days" is wrong. See Open question 4.

### A5. Files and tests

- **Files:** `index.html`, `src/ui/great-falls-ui.js`, `src/ui/cap-indicator.js` (`ROW_EF_ONLY`).
- **Tests to edit:** `test/cap-indicator.test.mjs` lines 114, 252 and 255 (the `'N/A (EF only)'` and `'N/A \u2014 EF only'` literals).
- **New test `test/plain-labels.test.mjs`:**
  - The part of index.html before `id="tab-docs"` contains none of `Target gauge`, `PoR →`, `LF scale`, `PoR→GF`, `GF→LF`, `Flow bin`, `Learned correction`, `120% ceiling`, `EF Cross-check`.
  - The kept `90% CI` is still there.
  - The `ft` label contains "Little Falls gauge scale".
  - The sources of great-falls-ui.js and cap-indicator.js contain none of `(EF only)`, `EF-ONLY`, `(EF trend)`, `obs)`.
- **Revert check:** put `Target gauge` back and the test fails.

## B. One compact notice

### B1. Current behaviour (quoted)

- index.html:128-131: `#gf-cap-note` (hidden, plain amber text, no role) with `#gf-cap-headline` and `#gf-cap-detail`.
- index.html:138-147: `#gf-divergence-advisory` and `#gf-residual-advisory`. Each is `hidden role="status"` with a bordered amber box and a title div and a body div.
- great-falls-ui.js:43-52 `renderCapIndicator`: `capView(estimate, Date.now())`, then `applyCapView(view, {note, headline, detail, row})`. It is called as `renderCapIndicator(null)` in the loading and no-estimate early returns (lines 121 and 158). It is called as `const capV = renderCapIndicator(gfEstimate);` at line 175, right after the big number is written.
- great-falls-ui.js:219-272: the two advisory blocks set `hidden` and write TITLE and BODY. They run only on the main path. The EF-only branch returns at line 208 before them. Because of that, a box shown by an earlier render stays on screen in EF-only mode.
- Strings today:
  - Cap: `CAP_HEADLINE` "Capped: the model reads higher than this." plus the detail. The detail is "The model estimates X cfs. The cfs and ft shown are held at Y cfs, which is 120% of the latest Little Falls reading (Z cfs at 14:40). " plus `CAP_LAG_CLAUSE`, plus `CAP_OLD_CLAUSE` when the reading is 3 h or older. The no-figures ("unknown") detail is "The model estimates a higher value. The cfs and ft shown are held at 120% of the latest Little Falls reading. " plus `CAP_LAG_CLAUSE`.
  - Advisory titles: "⚠️ Cross-check gauge disagrees — treat this estimate with extra caution." and "⚠️ Recent estimates ran low — treat this one with extra caution."
  - Both bodies end with "If the river looks higher than the number, believe the river."

### B2. Design

New pure module `src/ui/estimate-notice.js`. It has no DOM and no top-level browser globals, the same pattern as `cap-indicator.js`.

```
noticeView({ capLine, divergence, residual })
  -> { hidden, capLine, efLine, lfLine, closing }       // strings, '' when not shown
applyNoticeView(view, els)   // els = { box, cap, ef, lf, closing }; sets textContent and hidden on EVERY given element
NOTICE_CLOSING = 'Treat this estimate with extra caution. If the river looks higher than the number, believe the river.'
```

- `closing` is non-empty only when `divergence || residual`. So "believe the river" appears at most once, and never in the cap-only case. The cap note does not carry that sentence today, and adding it there would be new caution wording.
- `cap-indicator.js` changes:
  - `describeCap` and `capView` return one `line` instead of `headline` and `detail`. The `noteHidden`, `rowText` and `ciSuffix` fields stay.
  - `applyCapView` writes the `row` only. `ciRowText`, `formatClock` and the `ROW_*` constants stay.
- `divergence-advisory.js` and `residual-advisory.js`:
  - `*_ADVISORY_TITLE` and `*_ADVISORY_BODY` become one exported `DIVERGENCE_LINE` and one `RESIDUAL_LINE` each.
  - `shouldShow*` and `downgradeConfidence` are untouched.
- index.html: delete the three old blocks and add one box. Place it where the advisories sit now, after `#gf-confidence`.

```html
<div id="gf-notice" hidden style="margin-top:8px;padding:8px 10px;background:rgba(180,83,9,0.15);border:1px solid #b45309;border-radius:6px;font-size:0.6rem;line-height:1.5;text-align:left;color:var(--text-body);">
  <div id="gf-notice-cap" hidden></div>
  <div id="gf-notice-ef" hidden></div>
  <div id="gf-notice-lf" hidden></div>
  <div id="gf-notice-closing" hidden style="font-weight:600;"></div>
</div>
```

- Add one rule in `main.css`: `#gf-notice > div:not([hidden]) ~ div:not([hidden]) { margin-top: 4px; }`.
- great-falls-ui.js wiring:
  - `renderCapIndicator(estimate)` keeps its shape and its return value. It applies the cap row, then calls `applyNoticeView(noticeView({capLine, divergence:false, residual:false}), …)`.
  - The call sites stay: `renderCapIndicator(null)` twice, `renderCapIndicator(gfEstimate)` once, `const capV =` directly after the number write. The wiring test in `cap-indicator.test.mjs` pins all of this.
  - Replace the two advisory blocks (lines 256-272) with one call, `renderNotice(capV, divergenceShown, residualShown)`. It builds the view with `capLine: capV.noteHidden ? '' : capV.line`.
  - Delete the imports of the old TITLE and BODY constants.
  - Add no `return;` lines in `updateGreatFallsUI` or `renderGFCardGate`. The existing test splits the function body on `return;`.

### B3. Exact strings

Examples use X = 11,999, Y = 10,800, Z = 9,000 at 14:40.

| Piece | Text | Source |
|---|---|---|
| Cap line, cut | `Capped: the model estimates 11,999 cfs. The cfs and ft shown are held at 10,800 cfs, 120% of the latest Little Falls reading (9,000 cfs at 14:40). ` + `CAP_LAG_CLAUSE` + (old ? ` That Little Falls reading is over 3 h old.` : '') | The old detail, with "which is" cut. The old headline is cut to the word "Capped:" |
| Cap line, unknown (no figures) | `Capped: the model reads higher than this. The cfs and ft shown are held at 120% of the latest Little Falls reading. ` + `CAP_LAG_CLAUSE` | The old headline and detail, minus the repeated "The model estimates a higher value." |
| Cap line, tie | none (box line hidden) | Same as today: the note is hidden when the model value equals the shown value after rounding |
| EF line | `Cross-check gauge disagrees: Edwards Ferry has read well above what the upstream gauges suggest for several hours. That can be gauge noise at low water, or water entering below those gauges.` | Title text plus a shortened body |
| LF line | `Recent estimates ran low: they came in well below what Little Falls later measured. That often means rain-swollen local streams are adding water the upstream gauges cannot see. The current number may be low too.` | Title text plus the body |
| Closing | `Treat this estimate with extra caution. If the river looks higher than the number, believe the river.` | Both advisory titles end in "treat this … with extra caution". Both bodies end in the believe-the-river sentence. Both now appear once. |

Kept, shortened or dropped:

- `CAP_LAG_CLAUSE` is kept verbatim. Tests pin it and it is the cap's honesty sentence.
- `CAP_OLD_CLAUSE` is kept.
- `CAP_HEADLINE` is kept for the unknown case and cut to "Capped:" in the cut case.
- **Dropped from the EF body:**
  - "an independent cross-check just upstream of Great Falls"
  - "water this estimate may not fully see" (the closing line carries the caution)
  - "the Potomac"
- **Kept from the EF body:** the gauge-noise hedge, "water entering below", "well above", "several hours".
- **Dropped from the LF body:** "this model's", "the downstream check gauge". "Recently," becomes "Recent estimates ran low". The "often" and "may be low" hedges are kept.
- **Both "⚠️" glyphs in the old titles are dropped.** The amber box and the `" ⚠"` on the confidence label (unchanged) remain.
- **No role or aria-live** on the box. See B6.
- No new sentence is invented. Every sentence above exists today.

### B4. The 7 combinations (C = cap line active, E = EF advisory, R = residual advisory)

Cap "active" means `capView.noteHidden === false`, so a tie does not count. Order is always cap, EF, LF, then closing. All lines sit in one box. With none of the three, the box is hidden.

| # | C | E | R | Box contents |
|---|---|---|---|---|
| 1 | on | off | off | Cap line only. No closing. |
| 2 | off | on | off | EF line, then closing. |
| 3 | off | off | on | LF line, then closing. |
| 4 | on | on | off | Cap line, EF line, closing. |
| 5 | on | off | on | Cap line, LF line, closing. |
| 6 | off | on | on | EF line, LF line, closing. |
| 7 | on | on | on | Cap line, EF line, LF line, closing. |

The confidence text keeps its existing behaviour: one notch down per active advisory, with `" ⚠"`, regardless of the cap.

### B5. Behaviour nuance

The loading, no-estimate and EF-only renders now hide the box. This follows from calling `renderCapIndicator(null)` and `renderCapIndicator(gfEstimate)`, which now clear the whole box. Before, an advisory box shown by an earlier render stayed on screen in EF-only mode, because that branch returned before the advisory code. On first load the result is the same as today: hidden. The decision functions are unchanged. This is accidental stale state being cleaned up, not a change to when a note is decided. State it in the changelog.

### B6. Accessibility

- `#gf-estimate-display` is already `aria-live="polite" aria-atomic="true"`. The old advisories were nested `role="status"` regions inside it. The cap note was deliberately not (v39.3 comment).
- The new box has no role, like the cap note. A new notice is announced once, as part of the card.
- Nothing is lost for assistive tech: the text is still in the card.
- The guard test asserts the `#gf-notice` tag has no `role=` or `aria-live`.

### B7. Tests to edit

- **`test/cap-indicator.test.mjs`:**
  - `.headline` and `.detail` become `.line` (lines 95-103, the wording block 119-134, 143-166, 178-189, 199-225).
  - `x.headline.includes('the model reads higher than this')` applies to the unknown case only.
  - The reset test (230-263) now uses `{row}` only. Note and headline checks move to the new notice test.
  - `'index.html has the note and the row'` (337-344) checks `#gf-notice` (hidden, no role) and `#gf-input-ceiling`.
  - Keep: the end-to-end block, the no "upper limit" checks, the clock and old-clause checks, the rounding-tie checks and the wiring tests.
- **`test/divergence-advisory.test.mjs` (50-60):** check `DIVERGENCE_LINE`. It must match `/disagrees/i`, `/gauge noise/i`, must not match `/Edwards Ferry is (right|correct)/i`, and must not contain "believe the river".
- **`test/residual-advisory.test.mjs` (66-75):** `RESIDUAL_LINE` includes "Recent", "often", "may be low", and not "usually". Move the 'extra caution' and 'believe the river' checks to the closing constant.
- **`test/startup-refresh-behaviour.test.mjs` and `test/confidence-parity.test.mjs`:** no edit. The parity test must still pass untouched.

### B8. New tests (`test/estimate-notice.test.mjs`, pure)

- The 7 combinations plus the none case:
  - Exact line order.
  - `closing` empty when only the cap is on.
  - `NOTICE_CLOSING` appears at most once.
  - "believe the river" occurs exactly once per view.
- A cap line made from `describeCap` reaches the box unchanged. The same facts appear in the 'cut', old-reading and unknown cases: X, Y, Z, the clock time, "120%", `CAP_LAG_CLAUSE`.
- `applyNoticeView` resets every slot, using fake objects, including the sequence all-on, then all-off.
- Source guard that `great-falls-ui.js` uses `renderNotice(capV, divergenceShown, residualShown)` and no longer contains the old ids.
- **Revert check:** change `closing` so it is included when only the cap is on, and the 'cap only' test fails.

## C. Tidy up

### C1. Forecast cards: round the display text only

Current:

- great-falls-ui.js:616-619:
  `data-stage="${p.stage.toFixed(2)}" data-cfs="${p.cfs}"`, `<div class="fp-stage">${p.stage.toFixed(2)} ft</div>`, `<div class="fp-cfs">${p.cfs.toLocaleString()} cfs</div>`.
- `periods[].cfs` is already `Math.round(forecastCFS)`. `periods[].stage` is unrounded.
- `periods` feeds three things:
  - the card template, which will be rounded;
  - `renderForecastGraph(periods, …)`;
  - `storeForecastPredictions(periods)`. gf-learning.js:183-196 posts `predictedCFS: p.cfs, predictedStage: p.stage, source: p.source`, and its filter uses `p.source.startsWith('NWS')`.

New pure module `src/ui/forecast-format.js`:

```
roundForecastCfs(cfs): step = cfs<1000 ? 10 : cfs<5000 ? 50 : 100; Math.round(cfs/step)*step
formatForecastStage(stage): (Math.round(stage*10)/10).toFixed(1)
forecastSourceLabel(source) -> { text, title }
```

(`Math.round` rather than `toFixed` avoids "-0.0".)

Rules:

- Apply them only in the card template for non-current cards (`!p.isCurrent`). Never assign to `p.cfs`, `p.stage` or `p.source`. The posted values and `p.source` stay exactly as today.
- Keep `data-stage` and `data-cfs` unrounded (nothing reads them; grep found no reads).
- The "Now" card keeps the headline's own text (`stage.toFixed(2)`, exact cfs). It repeats the headline number, and two different values for one quantity would sit on screen. The headline is not rounded in this release (Open question 2).
- The trend arrow still compares unrounded values. It can show ▲ beside a number that equals "Now" when the rise is small. That is true, not a fix.
- Also round the graph tooltip so a tapped card and its tooltip agree: great-falls-ui.js:717-718 and forecast-graph.js:281-282. Y-axis ticks (forecast-graph.js:239) stay at 2 decimals.

Source labels, display only:

| `p.source` | Visible text | Tooltip |
|---|---|---|
| `NWS` | Weather Service | National Weather Service forecast (arrival time varies with flow) |
| `NWS+EF` | Weather Service | National Weather Service forecast, blended with the Edwards Ferry forecast (arrival time varies with flow) |
| `extrapolated` | Trend only | No National Weather Service forecast available. This is a straight-line trend from the current estimate. |

- This drops "+EF" from the visible text. It stays in the tooltip, and it is under 1% of the blend below about 6k cfs (CLAUDE.md).
- It replaces the current tooltip that wrongly says "NWS" for the extrapolated source.

Tests:

- `test/forecast-format.test.mjs`:
  - Edges: 994 -> 990, 995 -> 1,000, 4,974 -> 4,950, 4,975 -> 5,000, 10,812 -> 10,800, 0 -> 0.
  - Stage: 6.43 -> "6.4", -0.04 -> "0.0".
  - A frozen `periods` array is not mutated.
- A bundle behaviour test (esbuild, the same harness as `startup-refresh-behaviour.test.mjs`): run `updateForecastPeriods` with an NWS fixture and a stubbed `fetch`. Assert that `#gf-forecast-periods`'s `innerHTML` holds rounded text and that the POST body holds the unrounded `predictedStage` and the integer `predictedCFS`.
- **Revert check:** assign `p.stage = round(p.stage)` in the template and the POST assertion fails.

### C2. Hidden leftovers in index.html

Every element in index.html that is never made visible:

| Element (index.html) | JS reads and writes (v39.7) | Recommendation |
|---|---|---|
| `#gf-ci-range` and `#gf-ci-text` (132) | great-falls-ui.js:116, 152, 207: `getElementById("gf-ci-range").style.display = 'none'` (unguarded) | Remove the element and delete those 3 lines |
| `#gf-data-source` (134) | great-falls-ui.js:114, 145, 148, 185-186, 222-223, 225-226, 231-232 (unguarded writes) | Remove. Delete every write. Then the `porPct`, `efPct`, `delta` and `deltaLabel` block (lines 218-226) is dead: keep only the two `gf-estimate-label` writes in each branch. Also drop the `EF_MODEL` import if nothing else uses it (the forecast code still does, so keep it). |
| `#gf-accuracy` (148) | none | Remove the element only |
| `#gf-forecast-cfs`, `-stage`, `-hrs`, `-arrival` (155-158) | great-falls-ui.js:117-119, 153-155, 192-194, 275-278 (unguarded) | Remove. Delete those 13 lines. `fmtArrival` is then unused in great-falls-ui.js (still used by gauges-ui.js and exported from fetch.js): drop only the import line 34. |
| `#gf-validation` wrapper with `#gf-val-countdown` and `#gf-val-last` (241-244) | great-falls-ui.js:344 (unguarded). learning-ui.js:26 and 40 (`valLast`, guarded with `if (valLast)`) | Remove. Delete line 344 only. Keep `valCountdownText` and the guarded `learn-val-countdown` write (345-346). In learning-ui.js delete the `valLast` const and its `if` line. Fix the comment "Update both GF tab (hidden) and Learning tab elements". |
| `#status` (58, `display:none`, aria-live) | fetch.js:597 `const st`, and 5 writes at 616, 620, 625, 629, 634 (unguarded) | Remove. Delete those 6 lines. `#dot`'s title already carries the status. |
| Comment `<!-- Hidden elements for JS compatibility -->` and the "moved display to Learning tab" comment | none | Delete |

Checked and kept (they ARE made visible):

- `#gf-ef-crosscheck`: `display='block'` when an EF estimate exists.
- `#forecast-accuracy`: shown when there are at least 10 validations.
- `#gf-graph-tooltip`, `#about-tooltip`, `#error-banner`, `#offlineBar`, `#gfRetryBtn`.
- Learning-tab elements (`#pinError`, `#learnUnlocked`, `#dash-ice-row`, `#valChartTooltip`).

New test `test/hidden-leftovers.test.mjs`:

1. The removed ids appear nowhere in `index.html`, `src/` or `test/` (the test file lists them in a constant that it excludes from its own scan).
2. Null-safety: parse every direct `document.getElementById("X").` (no guard) in `src/ui/great-falls-ui.js`, `src/ui/gauges-ui.js`, `src/ui/learning-ui.js`, `src/data/fetch.js` and `src/ui/creeks-ui.js`. Each static id must exist as `id="X"` in index.html. This is what the fake-DOM tests cannot do.
- **Revert check:** re-add one deleted write and test 2 fails.

### C3. Creeks "Last ran": drop it

Current:

- fetch.js:377-379 `if (q >= CREEK_RUNS[siteCode].runnable) { try { localStorage.setItem('creek_lastran_…', new Date().toISOString()); } catch(e) {} }`. The browser's clock is stamped whenever this device sees the creek running.
- creeks-ui.js:31 `<span id="creek-lastran-${id}"></span>`.
- creeks-ui.js:259-280 reads the key and writes "Last ran: now / today / yesterday / Nd ago / unknown".
- creeks-ui.js:308-326 reads all keys for the quiet-banner suffix " — Last activity: …".
- creek-level.js:93 and 123: the `lastRan` field of the card view.

I recommend dropping all of it. Deriving from `history` is not simpler:

- It needs a new field and new text.
- The history is thinned to every 4th reading, so short peaks are missed.
- The expanded chart already plots the 24 h history with the threshold line.

Changes:

- Delete fetch.js:377-379.
- Delete the span at creeks-ui.js:31.
- Delete creeks-ui.js:241 and 259-280.
- Delete creeks-ui.js:308-326. The quiet banner becomes `${banner.emoji} ${banner.text}` through the same branch as the other tones.
- Delete the `lastRan` field in creek-level.js (lines 93, 123).
- Side effect: today an empty `<span>` still renders a stray "·" through `.creek-meta span::after`. Removing it fixes that (inferred from CSS, unverified in a browser).
- Old `creek_lastran_*` keys stay in users' storage. They are harmless. Do not add cleanup code.

Tests:

- `test/creek-level.test.mjs`:
  - Lines 297-323: rename the test, drop the `lastRan` assertions, keep the colour checks.
  - Line 366 `globalThis.localStorage = …`: replace with a `localStorage` that throws on any access. This proves nothing reads it.
  - Line 380: replace the `creek-lastran` assertion with "no element `creek-lastran-*` was requested".
  - Add a case for an all-below set that expects `<div class="creeks-banner quiet">⚫ Nothing running</div>` exactly.
- Source guard: `creek_lastran` and `lastRan` appear nowhere in `src/` or `index.html`.
- **Revert check:** re-add the `localStorage.getItem` and the throwing stub fails the test.
- TODO.md A9z item (5) becomes resolved.

## D. Test-only items (TODO S6)

### D1. Map outlines as behaviour

- Remove the test `'map.js: initMap fetches no outline file; toggleMap loads them on show'` from `test/startup-wiring.test.mjs` (lines 40-48), and its mention in the file header.
- Add `test/map-outlines-behaviour.test.mjs`:
  - Bundle `src/ui/map.js` and `src/state/store.js` with esbuild (`platform: 'node'`, `write: false`), with a plugin that resolves `leaflet` to a virtual module exporting a chainable recording stub as the default export (a function-target `Proxy` that returns itself for every property or call). Real Leaflet touches `document` when imported and fails in Node.
  - Fake `document`: `getElementById` that returns a stub object, `createElement`, `body.classList.toggle`.
  - Stub `fetch`: record URLs and return `{ json: async () => ({type:'FeatureCollection',features:[]}) }`.
  - Call `initMap()`, then let microtasks run. Assert no recorded URL matches `/potomac-.*\.geojson/`.
  - Call `toggleMap()` (show): assert both `/potomac-watershed.geojson` and `/potomac-nhd.geojson` are fetched exactly once.
  - Call `toggleMap()` twice more: still one fetch each.
- **Revert check:** call `ensureMapOutlines()` from a helper inside `initMap` and the first assertion fails (the old text test would miss that).

### D2. `learning-deadline` guard

- Give the two hung-load tests `{ timeout: 2000 }` and wrap their awaits in `within(p)`:
  - `'failures on a later cycle keep the previous payload (timeout, 500, bad JSON)'` (the `await p` after `fireDeadline()`);
  - `'learning:loaded is emitted once per settle, for each outcome'` (the third block).
- Reset the shared slot between tests. The slot is the module-level `inFlight` in `gf-learning.js`, which is private. Do it without changing production code: `beforeEach` loads a fresh module copy with `await import('../src/learning/gf-learning.js?case=' + (++n))` and assigns `loadGFLearningData` from it. The store and event bus are shared, so the assertions on `store` still work. Keep the existing `store.setLearningInFlight(null)` in `afterEach`.
- **Revert check:** remove the `Promise.race` in `fetchJsonWithDeadline` and these tests must fail at about 2 s, not hang. Do this by hand once.
- Not verified here: that `node --test` accepts the `?case=` import variant. I expect it works for local files. Check at step 1.

## E. Stale comment

fetch.js:226 `// If no valid reading in 2-day window, still mark as ice-affected` becomes "…in the 7-day window (period=P7D)…". The `console.log` text at line 231 ("Ice-flagged for >2 days") is the same staleness. Change it in the same edit; it is log-only and no test reads it. The UI strings are Open question 4.

## F. New and changed visible strings (owner table)

| Where | Old | New |
|---|---|---|
| Top card, small text | 11,560 sq mi • Target gauge | 11,560 sq mi • Real gauge below Great Falls |
| Line under it | PoR → LF: ~26 hrs | Point of Rocks to Little Falls: ~26 hrs |
| Under the big number | cfs (LF scale) | cfs |
| Under the big number | ft (LF scale) | ft on the Little Falls gauge scale |
| Under forecast cards | ▲▼ vs now • tap card or graph for details | ▲▼ vs now • ft are on the Little Falls gauge scale • tap card or graph for details |
| Forecast cards | 6.43 ft and 10,812 cfs (future cards) | 6.4 ft and 10,800 cfs (rule in C1) |
| Forecast card source | NWS / NWS+EF / extrapolated | Weather Service / Weather Service / Trend only |
| Great Falls card (ice case) | ❄️ EF-ONLY ESTIMATE; (EF trend); Confidence: LOW (EF only) | ❄️ ESTIMATE FROM EDWARDS FERRY ONLY; (Edwards Ferry trend); Confidence: LOW (Edwards Ferry only) |
| Notice | up to three boxes with titles "⚠️ Cross-check gauge disagrees — treat this estimate with extra caution." and "⚠️ Recent estimates ran low — treat this one with extra caution." | One box. Lines "Capped: …", "Cross-check gauge disagrees: …", "Recent estimates ran low: …" and, with an advisory, "Treat this estimate with extra caution. If the river looks higher than the number, believe the river." (full text in B3) |
| Inputs panel | Travel time PoR→GF; Travel time GF→LF | Travel time, Point of Rocks to Great Falls; Travel time, Great Falls to Little Falls |
| Inputs panel | Flow bin (12 obs) | Flow range (12 checks) |
| Inputs panel | Learned correction | Adjustment learned from past errors |
| Inputs panel | 120% ceiling; N/A (EF only); N/A — EF only | Cap at 120% of Little Falls; N/A (Edwards Ferry only); N/A (Edwards Ferry only) |
| Inputs panel | EF Cross-check; Edwards Ferry power-law estimate | Edwards Ferry check; Estimate from the Edwards Ferry gauge alone |
| Creeks card | Last ran: now / today / yesterday / 3d ago / unknown | (removed) |
| Creeks banner | ⚫ Nothing running — Last activity: Rock Creek, 2d ago | ⚫ Nothing running |
| Kept | 90% CI | 90% CI (wording waits for TODO A8) |

## G. Documentation that quotes changed strings

- **CLAUDE.md:**
  - Header "Current Model Parameters (v39.7)" becomes v39.8, and a new v39.8 bullet.
  - The v39.3 cap bullet quotes the note ("Capped: the model reads higher than this.", the "120% ceiling" row). Update it.
  - The v37.13 and v37.15 bullets mention the advisory and the "second amber banner". Update them to "one notice".
  - Say in the v39.8 bullet that `SERVER_VERSION` stays v39.6, and that the `shownConfidence` lines are untouched.
- **src/assets/tech-appendix.md:**
  - Line 299 (the cap indicator text, the "120% ceiling" row).
  - Lines 333 and 358-359 (the "amber … advisory" and "second amber advisory").
  - Line 836 (current version), line 838 (range "v16 through v39.8"), a new v39.8 paragraph near 840, and the footer at line 856.
- **README.md:** line 6 (version), line 58 ("Current Model (v39.8)"), line 161 (test count), a new table row near 178, and the footer at line 258. The older v39.3 row (182) is history, so leave it.
- **src/assets/CHANGELOG.md:** a new first row. `test/howitworks-text.test.mjs` requires a row for the current version and requires the versions to agree.
- **TODO.md:** line 7 version and test count, S6 done, A9z (5) resolved, and F-items of the CX review that this release covers (F3 partly, F7, F8 rounding, F10, F12 jargon).
- **index.html:** `<meta name="app-version" content="v39.8">` (line 8) and `#app-version-text` (line 724). `test/seo-basics.test.mjs` pins that they match.
- **How It Works prose:** checked, no change needed. It names none of the changed labels. The "PoR → Little Falls" table header (line 429) is How It Works and stays.

## H. Sequence (run `npm test` after each step; the app works after each)

0. Record the baseline: 1297 tests, 2 skips.
1. **D1, D2, E.** Tests and one comment, no behaviour change.
2. **C2 hidden leftovers** with the guard test. Delete the elements and their writes in one commit-sized step.
3. **C3 creeks.**
4. **C1 rounding** (new `forecast-format.js`).
5. **A labels** (index.html strings, great-falls-ui.js strings, `ROW_EF_ONLY`).
6. **B notice** (new `estimate-notice.js`, cap and advisory modules, index.html, `main.css`, tests).
7. **Version and docs** (section G), then the full suite, then a fresh auditor on the finished code per CLAUDE.md.

## I. Risks, ranked

1. **A missed write to a deleted element** throws inside `updateGreatFallsUI` and blanks the card. Mitigated by the explicit line list in C2 and the static id guard. The fake DOM in the tests cannot catch this.
2. **Information a visitor has today that the single box drops:** the explanation sentences listed in B3 (the "independent … upstream of Great Falls", "may not fully see", "downstream check gauge" phrases), the two "⚠️" glyphs, and the nested `role="status"`. This is a deliberate shortening. See Open question 1.
3. **Another module reading the old ids.** Grep shows only great-falls-ui.js and cap-indicator.test.mjs read them.
4. **Rounding.** Displayed numbers differ from the stored ones by design. The "Now" card stays exact, the rest are rounded, and the arrow still uses unrounded values.
5. **Layout.** The box is wider than the old cap text and moves below the confidence line. The cap text is now one long paragraph.
6. **Tests that read source text** (`confidence-parity`, the `cap-indicator` wiring block). Edits that move or rename those lines break them.
7. **Stale advisory cleanup** (B5).

## J. Not verifiable without a browser (owner checks on a phone)

- The single box at about 360 px: height, wrapping of the cap line (two to three sentences), the closing line in bold, and the spacing between lines.
- The `ft on the Little Falls gauge scale` label under the big number wrapping beside the `cfs` label.
- `Point of Rocks to Little Falls: ~26 hrs` on one line.
- "Weather Service" on the forecast cards in the 5-column, 3-column and 2-column grids.
- The creek card meta row after the span is removed.
- A screen reader announcing the box once.
- The case with no advisory but the cap on. Force it with DevTools if needed.

## K. Recommend NOT doing

- Do not rewrite the How It Works tab (the owner excluded it).
- Do not change the unavailable-state wording or the three reason lines.
- Do not alter the confidence label logic, the `" ⚠"` suffix, or the `shownConfidence` lines.
- Do not replace "90% CI" with "9 in 10" until A8 settles the band.
- Do not round the headline number or the "Now" card.
- Do not add a role or aria-live to the box.
- Do not use `innerHTML` for the notice. Use fixed slots with `textContent`.
- Do not raise font sizes, move the Little Falls card, or add an age line. Those are other CX findings (F2, F7, F3).
- Do not add a localStorage cleanup for the old `creek_lastran_*` keys.
- Do not "derive" last ran from history.

## Open questions for the owner

1. **Short lines versus full sentences.** The plan drops explanation phrases from the two advisories (listed in B3) to get one short line each. Do you want that, or the full body sentences kept inside the box (about three lines longer)? I recommend short.
2. **Headline rounding.** Forecast cards are rounded, but the big number and the "Now" card stay exact so they match each other. Do you also want the big number rounded? Not recommended in this release.
3. **Creeks "Last ran".** Confirm: drop it and the "Last activity" banner suffix. I recommend drop.
4. **">2 days" ice strings.** Fix the wrong ">2 days" text in the gauge popups and row titles (gauges-ui.js:176, popup), which should say 7 days? It is outside the three approved items.

## Things I could not verify

- Rendering, wrapping and the real look of the box: no browser.
- That the esbuild plugin approach for stubbing `leaflet` and the `?case=` module re-import work under `node --test`. Both are standard but I did not run them.
- The final test count. I ran nothing.
- That the `flowBin` value shows as a range such as `6000-12000` on the panel. The constants say so (`GF_FLOW_BINS`), but I did not trace the rendered value end to end.
- That `.creek-meta span::after` produces a stray dot for the empty span today (inferred from the CSS).

### Critical Files for Implementation
- /Users/sebjilke/Desktop/PotomacPulse/src/ui/great-falls-ui.js
- /Users/sebjilke/Desktop/PotomacPulse/index.html
- /Users/sebjilke/Desktop/PotomacPulse/src/ui/cap-indicator.js
- /Users/sebjilke/Desktop/PotomacPulse/src/ui/creeks-ui.js
- /Users/sebjilke/Desktop/PotomacPulse/test/cap-indicator.test.mjs

---

## L. Audit response (independent plan audit 2026-11-12: approve_with_changes) and final wording

The audit is in `clean-screen-plan-2026-11-12.PLAN_AUDIT.md`. Orchestrator rulings, 2026-11-12. Where a ruling differs from the text above, the ruling wins. The implementer works from this section plus the audit's exact wording.

| Finding | Severity | Ruling |
|---|---|---|
| PA-1 EF line loses "may not fully see" | must-fix | Accepted. `DIVERGENCE_LINE` ends "... or water entering below those gauges, water this estimate may not fully see." Test added. B3's claim becomes "reworded from existing sentences". |
| PA-2 guard misses writes through a variable | must-fix | Accepted. The guard collects every static id passed to `getElementById` anywhere in `src/**/*.js` and requires it in `index.html`, with an allowlist of the eight run-time ids the audit lists. Revert check as the audit states. |
| PA-3 creeks test cannot fail | should-fix | Accepted. Recording stub with zero calls asserted; `test/creek-level.test.mjs:115` edited too. |
| PA-4 tooltip rounding must exclude Now and history points | should-fix | Accepted. Round only when `!d.isHistory && d.hrs > 0`; two tests. |
| PA-5 arrow can contradict the rounded numbers | should-fix | Accepted. Show ● when the rounded card value equals Now rounded by the same rule; otherwise compare raw values as today. Test with the audit's example. |
| PA-6 "(LF scale)" on cfs | should-fix | Option (a): the cfs label becomes "cfs". The rationale is corrected: the number is Little Falls discharge one travel time ahead (Tech Appendix 6.1), and that precision stays in How It Works and the appendix, not on the label. The owner saw "cfs" in the wording table. |
| PA-7 "Flow range" reads as uncertainty | should-fix | Accepted. "Flow band", value "(12 checks)". |
| PA-8 cap row label | should-fix | Accepted. "Display cap (120% of Little Falls)". |
| PA-9 per-card source label wraps | should-fix | Accepted. No per-card source text. One line under the forecast cards, set from the periods' source: "Source: National Weather Service forecast" for `NWS` and `NWS+EF`; "No Weather Service forecast. Rough projection." for `extrapolated`. Its `title` carries the longer text (with PA-11 for the extrapolated case). The card `title` attributes follow the same per-source text. `p.source` is never changed. |
| PA-10 legend row 6 | should-fix | Accepted. Row 6 is dropped; the legend line keeps its current text. |
| PA-11 extrapolated tooltip untrue | should-fix | Accepted. "No National Weather Service forecast available. A rough projection from the current estimate and the upstream reading." |
| PA-12 storage guard in the C1 test | should-fix | Accepted, all four assertions. |
| PA-13 behaviour tests through the existing harness | should-fix | Accepted, the three tests; the source guard stays only as a backstop. |
| PA-14 notice clearing direction | note | Accepted, in this form: `renderCapIndicator(null)` (the early returns) clears the whole box; `renderCapIndicator(gfEstimate)` on the main path updates only the inputs-panel row and returns the view WITHOUT touching the box; the Edwards-Ferry-only branch calls an explicit clear before its existing `return;`; `renderNotice(capV, divergenceShown, residualShown)` later sets all slots. If anything throws in between, the box keeps its previous state, as today. The pinned lines are not moved. |
| PA-15 stale advisories in all early-return states | note | Accepted as a correction to B5; clearing is correct in all three. |
| PA-16 D1 and D2 requirements | note | Accepted, all four requirements. |
| PA-17 docs and verification | should-fix | Accepted. `tech-appendix.md` line 598 is added to the list. No browser tool exists in this session, so the browser check is an owner check and an unverified gap until done; step 7 says so. |
| PA-18 anchors and claims | note | Accepted. Line numbers as the audit gives them; the Edwards-Ferry-only state runs when Point of Rocks OR Little Falls is ice-affected. The pre-existing `gf-input-por` text in that state is logged in TODO, not fixed. |
| PA-19 jargon not in the table | note | Listed in TODO as seen and not changed (`#forecast-accuracy` wording; the "(observed)" label on past estimate points). |
| PA-20 Little Falls label and aria | note | Accepted. "Measured gauge below Great Falls"; the `#multVal` aria-label becomes "travel time"; the wraps are added to the owner's phone list. |
| PA-21 cap note look; lead-ins | note | Accepted. Each line has a lead-in span ("Capped:", "Cross-check gauge disagrees:", "Recent estimates ran low:") in the amber title style and a text span, both set with `textContent`. |

Defaults (the auditor agreed with all four): (1) short lines; (2) the headline number and the "Now" card stay exact; (3) "Last ran" and the banner suffix are dropped; (4) the wrong ">2 days" ice wording in the gauge list is not changed in this release (TODO line added) unless the owner asks.

Final wording, where it differs from table F: "Measured gauge below Great Falls"; "Flow band (12 checks)"; "Display cap (120% of Little Falls)"; no per-card source label, one source line under the cards; legend line unchanged; EF line ends with "water this estimate may not fully see."

# Plan: creek level bands and How It Works corrections (TODO A9, v39.4)

Status: FINAL SPECIFICATION (revised 2026-11-10 after the independent plan audit; see "Audit response" at the end). All 14 audit findings are accepted.
Scope: client display and page text only. No change to the Great Falls estimate, server code, learning, `src/model/`, `src/estimation/`, or dependencies. SERVER_VERSION stays v39.2.

## Problem
1. The Creeks tab says "Running!" in green at any flow of at least the minimum. On 2026-10-11 Difficult Run was at 8.1x its 200 cfs minimum (peak 1,620 cfs) and was at 5x or more for 6.8 h. The card stayed green.
2. Four How It Works statements are wrong or overclaim (below).

## Facts that limit the design
- CREEK_RUNS has one number per creek, the minimum (`runnable`), src/model/constants.js:114-119. It is NOT edited. No high-water value is added.
- No high-water level exists anywhere in the repo or docs. The app cannot say what is too high for any creek and must say so.
- fetch.js sets `running = q >= runnable` and stores `time` (the reading time). It stays unchanged. The UI stops using `running` for colour, text, sort, banner and dot, and uses the pure module instead.
- fetch.js drops negative and NaN values (`continue`), so a sentinel (-999999) leaves the old `creekData[id]` in place with no mark. The service worker may serve a cached creek response up to 6 h old (config/runtime-caching.mjs:52-63). Hence the stale state below.
- Trend (fetch.js:344-352) compares the newest value with the value 8 steps earlier. For 15-minute gauges that is about 2 h. Rock Creek and Sligo report about every 5 min, so for them it is about 40 min. No code change. The arrow only says up, down or steady (change over 10%).
- Nothing else reads creekData or CREEK_RUNS except src/ui/creeks-ui.js and src/data/fetch.js (no map, dashboard, notification, page title or share text).
- USGS qualifiers (Ice, Eqp, P) are not exposed by fetch.js. Ice usually arrives as -999999 and is dropped. No change.

## Bands (ratio r = cfs / minimum, decided on the exact ratio)
| State | Rule | Colour | Card status text |
|---|---|---|---|
| none | q null, NaN, negative, -999999, not finite | grey | cfs "❓ No data", status "Gauge offline or no response" |
| old | reading time more than 120 min before now (or missing/invalid) | grey | "Old reading: last reading was 3 h ago. The current level is unknown." |
| unknown minimum | runnable 0, missing, non-finite | grey | "No minimum flow is set for this creek." (no ratio, no band) |
| below | r < 1 | grey | "Needs ≥200 cfs" (+ " (micro-run)" for Sligo), unchanged |
| run | 1 ≤ r < 2 | green | "Running: 1.6x the 200 cfs minimum" |
| high | 2 ≤ r < 5 | amber | "2.4x the 200 cfs minimum. Potomac Pulse has no high-water level for this creek, so it cannot say whether this is too high." |
| veryhigh | r ≥ 5 | red | "8.1x the 200 cfs minimum, far above it. Potomac Pulse has no high-water level for this creek, so it cannot say whether this is too high." |

- PA-1 rounding: the shown ratio is truncated, `Math.floor(q * 10 / minimum) / 10`, one decimal, and clamped inside its band. From 10x up a whole number is shown (`Math.floor(r)`), so "12x". The text can never show "2.0x" in green or "5.0x" in amber. A sweep test over the displayed string proves it.
- PA-2: "upper limit" never appears in a visitor-facing string. The word "Running" appears only in the run band (1x to under 2x), with no exclamation mark. No safe, unsafe, good, fine, recommended, go, don't go, instruction to paddle or not paddle.
- PA-5 stale: age is computed from the reading time against `now`. More than 120 min is old. Age text: whole minutes under 60 min is not reached; hours (floor) below 48 h, days (floor) from 48 h; a missing time says "of unknown age". The old state shows grey dot, grey cfs with " (old)", no trend arrow, grey chart, no "Last ran: now". A failed fetch therefore cannot leave an unmarked old band, because the UI re-evaluates age on every `data:updated`. The cfs value stays visible but marked old.
- Why 2x and 5x: 2x marks "no longer near the minimum"; 5x is the cut the October audit used (CRITIC.txt:101). Conventions, not safety facts. The text says "minimum", never "limit".

Banner (pure `creekBanner(bands, total)` returns `{emoji, text, tone}`):
- At least one creek at or above its minimum: "2 of 4 creeks at or above their minimum flow" and, only when at least one creek is at 5x or more, " · 1 at 5x or more". `total` comes from the creek count. If any creek has an old reading, " · N with old readings" is appended.
- Tone and emoji follow the HIGHEST band among creeks: run = green `running` 🟢; high = amber `high` 🟠; veryhigh = red `veryhigh` 🔴. No green anywhere when a creek is at 2x or more (PA-3).
- None at or above: "Nothing running" (grey `quiet`, ⚫); the UI appends "— Last activity: ..." as today; " · N with old readings" is appended if any.

Tab dot (pure `creekTabDotClass(bands)`): '' when no creek is at or above its minimum; `has-running` (green) when the highest band is run; `has-high` (amber) at high; `has-veryhigh` (red) at veryhigh. Old and none creeks do not count.

"Last ran": "Last ran: now" only in the run band. In high and veryhigh the field is blank (it must not read as encouragement). Other states use the existing today/yesterday/Nd ago text.

Trend arrows: glyph and title stay; colour is neutral (text-tertiary) for all three (PA-11). Hidden for old and none.

Chart: line, area gradient and current-value dot take the band colour (green RGB 74,222,128; amber 251,191,36; red 239,68,68; grey 100,116,139). The dashed threshold line stays as is.

Sort: creeks at or above their minimum (run, high, veryhigh) first by cfs descending, then the rest. Old creeks sort with the rest.

## Module layout (PA-12)
NEW src/ui/creek-level.js. Pure, no DOM, no browser globals. Exports:
- `CREEK_BANDS` (edges 1, 2, 5), `OLD_READING_MIN` (120), `NO_HIGH_WATER_LEVEL` (the shared sentence).
- `creekLevel(q, runnable, readingTime, now)` returns `{band, ratio, shown, label}`.
- `creekCardView(d, c, now)` returns the whole card view: `{band, cfsText, cfsColor, dotColor, borderColor, status, statusColor, trendText, trendTitle, trendColor, chartRgb, lineColor, lastRan, active}`. `d` may be undefined (no data).
- `creekBanner(bands, total)` and `creekTabDotClass(bands)`.
src/ui/creeks-ui.js only imports and assigns these values. It contains no `Running` text, no `running ?` ternary and no `accent-green` literal. CSS: `.creeks-banner.high`, `.creeks-banner.veryhigh`, `.tab[data-tab="creeks"].has-high::after` and `.has-veryhigh::after` in src/styles/main.css beside the existing rules.

## What October would have shown (peak, band)
| Creek | Peak | Multiple | Card at peak |
|---|---|---|---|
| Difficult Run | 1,620 | 8.1x | red "8.1x the 200 cfs minimum, far above it. ..." |
| Rock Creek (400) | 978 | 2.4x | amber |
| Sligo Creek | 556 | 2.7x | amber (truncated; the exact ratio is 2.78) |
| NW Branch Anacostia | 322 | 1.6x | green "Running: 1.6x the 200 cfs minimum" |
Honest limit: for Rock, Sligo and NW Branch the bands say little, because they never got high. Whether 2.4x on Rock Creek is a lot is a fact only the owner or American Whitewater can supply (out of scope, recorded in TODO.md).

## How It Works and Tech Appendix corrections (PA-7 to PA-10)
index.html line 343 (three of the four) and line 352:
1. Cap. Old: "The estimate is also capped at 120% of the latest Little Falls reading. When the cap is holding the number down, the Great Falls card says so and shows what the model itself estimated."
   New: "The estimate is also capped at 120% of the latest Little Falls reading, which can be over an hour old. Rain that falls between Point of Rocks and Great Falls can push the real flow above the capped number. When the cap holds, the Great Falls card says so and shows the model's own value."
2. Confidence legend (line 352). Old: "High = solid, plan around it / Medium = could shift 10-20% / Low = ballpark only".
   New: "Confidence: High / Medium / Low is the label shown with the estimate. It mostly reflects how complete the inputs are (tributary gauges reporting, upstream timing, Edwards Ferry agreeing). It also drops when the latest check against Little Falls was far off. It is not a measured error rate. In one event, the October 2026 flood, the typical (median) miss was about 9% at every level, and a few High readings were off by more than 25%." (The coloured High, Medium, Low labels stay as the key.) The 90% band wording (index.html:215) is left to A8.
3. Learning (line 343). Old: "The model improves continuously, even when no one is looking at the site."
   New: "The model learns from most checks, even when no one is looking at the site, but it can lag a fast-changing river."
4. Hourly check (line 343). Old: "Every hour, the server checks its earlier prediction against what Little Falls actually recorded when that water arrived."
   New: "The server checks one earlier prediction at a time against what Little Falls recorded when that water arrived. A new prediction is stored only after the previous one has been checked, so most hourly predictions are never scored."
Not changed: the "~6 hrs later" diagram. Noted, not fixed (recorded in TODO.md as out of scope): travel-time numbers disagree between index.html :273, :331 and the table at :422-426.

src/assets/tech-appendix.md:
- :500 "A serverless function executes every hour" is TRUE and stays.
- :506 (step 6) becomes "Make a new prediction; store it only if no earlier prediction is still waiting to be checked".
- :508 "The model improves continuously, even when no browsers are open." becomes "The model learns from most checks, even when no browsers are open, but it can lag a fast-changing river."
- :347-348 "every hour a pending prediction matures" becomes "whenever the single pending prediction matures".
- Creeks note: the appendix has no creek section, so the note lives in the v39.4 version-history entry only (no new section).
- :814 current version v39.4, :816 "(v16 through v39.4)", new v39.4 history entry, :826 Generated-by footer.
README.md: :6, :58 (v39.4), :101 ("Validation: Server-only, once a prediction matures; one prediction is pending at a time."), :161 test count, :178 new v39.4 row, :254 last-updated line. CLAUDE.md: "Current Model Parameters (v39.4)" and a "Creek level bands (v39.4)" bullet. src/assets/CHANGELOG.md: v39.4 row. index.html:6 title. TODO.md: header version and test count, A9 done, follow-ups, Recently completed. package.json is not touched.

## Tests (new files only: test/creek-level.test.mjs, test/howitworks-text.test.mjs; no existing test file modified)
All call the pure functions. No test passes because a file exists. Text guards read page text only where the page text is the thing under test (index.html, docs).
1. Edges by band at r = 0.999, 1, 1.999, 2, 4.999, 5, for every creek in CREEK_RUNS, including the shown string.
2. PA-1 sweep: q from 0 to 100x minimum in 0.01 cfs steps for minimums 200 and 400: green shown < 2.0, amber shown at least 2.0 and below 5.0, red shown 5.0 or more; no "Running" outside the run band.
3. PA-6 inputs: null, undefined, NaN, negative, -999999, Infinity, runnable 0, null, NaN, 1000x (no "Infinityx", whole number).
4. PA-5: reading exactly 120 min old is fresh; 121 min old is old; old has no "Running", states the age and "unknown"; missing time is old; the stale view has grey colours and no trend.
5. Strings: exact strings for run, high, veryhigh, old, none, banner (mixed bands), quiet banner. Advice guard over every visitor-facing creek string (all bands, banner, quiet, with the audit's widened regex plus "upper limit", "too low to matter", "paddle", "go").
6. October fixtures keyed by creek name: Difficult Run veryhigh, Rock Creek high, Sligo high, NW Branch run.
7. Tab dot class by highest band; banner tone and emoji by highest band; no green banner or dot when any creek is at 2x or more; "Last ran: now" mode only in run.
8. Card view colour classes: dot, cfs, border, chart RGB, line colour come from the module; trend colours neutral.
9. UI is bound to the pure module: creeks-ui.js is exercised through a small fake-DOM harness that calls `updateCreeksUI()` / the renderer with stub `document`, and the text written to the DOM equals `creekCardView(...).status`. Source guard (secondary, as in cap-indicator.test.mjs): creeks-ui.js imports creekCardView, creekBanner, creekTabDotClass and contains no `Running`, no `running ?`, no `accent-green` literal.
10. Page text: index.html and tech-appendix.md and README no longer contain the old phrases ("plan around it", "improves continuously", "Every hour, the server checks", "every hour a pending prediction", "Validation: Server-only, every hour"); each new sentence is present; index.html has no "upper limit".
11. Existing suite untouched; parity and characterization tests must still pass.

## Side effects
- Some users will read a red banner as "go" or "stay away"; the wording only describes.
- Existing users who liked the green cue see amber at 2x. Intended.
- A creek can sit in amber for hours in ordinary high-ish rain. Amber is information, not a warning.
- Colour is not the only signal: the label text carries the band.
- Card cfs uses Math.round, so Rock at 399.6 shows "400 cfs" next to "Needs ≥400". Pre-existing; follow-up, not A9.
- The creek footer (index.html:95) "Thresholds are approximate, always scout unfamiliar runs" is pre-existing advice. Left alone.

## Cannot be verified without a real browser (unverified gaps)
- Colours and contrast in light and dark theme, banner wrapping at phone width, the amber and red tokens in theme.css rendering as intended.
- The chart recolouring and the label length (the high-water sentence is long) fitting inside the card at 320 px.
- Screen reader reading of the new status line.
- Live USGS response with the 5 s timeout and the service worker cache. Unit tests prove only the pure logic and the text.
- PA-14: the amber flow line (`--accent-amber` #fbbf24) is distinguishable from the amber dashed threshold line (`--accent-loading` #f59e0b, creeks-ui.js:172); and the gradient receives the RGB triplets for amber and red and renders them.
- PA-14: the tab dot and banner colours (amber, red) are legible in the real tab bar in both themes.

## Out of scope (recorded in TODO.md)
- Per-creek high-water values supplied by the owner (with source). With them, add `upper` and `upperSource` and change the label.
- The travel-time inconsistencies on the How It Works page.
- Math.round on card cfs vs the minimum.

## Audit response
All 14 findings ACCEPTED.
- PA-1 ACCEPTED: shown ratio truncated with Math.floor(q*10/min)/10, band on the exact ratio, sweep test on the displayed string.
- PA-2 ACCEPTED: no "upper limit" in any visitor string; auditor's wording used exactly; "Running" has no exclamation mark.
- PA-3 ACCEPTED: tab dot and banner take the highest band; green emoji removed (follows the tone); "Last ran: now" only in the run band.
- PA-4 ACCEPTED: banner reads "N of 4 creeks at or above their minimum flow · M at 5x or more", total built from the creek count.
- PA-5 ACCEPTED, in scope: readings over 2 h old get a grey old state with age and "unknown level"; no unmarked old band after a failed fetch.
- PA-6 ACCEPTED: pure function guards null, NaN, negative, -999999, zero or missing minimum, very large ratios (whole number from 10x).
- PA-7 ACCEPTED: appendix :506, :508, :347-348 and README:101 corrected; the true :500 line stays.
- PA-8 ACCEPTED: confidence legend states what the label measures and the median miss in one event.
- PA-9 ACCEPTED: cap sentence says rain between Point of Rocks and Great Falls.
- PA-10 ACCEPTED: hourly-check sentence uses the auditor's wording; learning sentence kept.
- PA-11 ACCEPTED: trend arrows neutral in colour; the trend window is about 2 h for 15-minute gauges and about 40 min for Rock Creek and Sligo.
- PA-12 ACCEPTED: card view, banner and tab-dot class come from the pure module; tests call it; no file-exists tests.
- PA-13 ACCEPTED: CHANGELOG row, appendix :814/:816/:826, README :6/:58/:161/:254 and the rest updated; package.json untouched.
- PA-14 ACCEPTED: amber line distinction and gradient RGB checks added to the browser-only list.

## Post-review amendments (2026-11-10, after the independent re-audit)
1. Banner when levels are unknown. `creekBanner` counts old and no-data creeks. With a current reading at or above minimum: the usual text plus " · K with old readings" and/or " · J with no data". With none, and every creek current: "Nothing running" unchanged. With none, and some old or no data: "No current reading at or above minimum · K with old readings · J with no data. Levels for those creeks are unknown." (zero parts omitted). With all four old or no data: "Creek levels unknown · K with old readings · J with no data". New tone `unknown`, grey (`.creeks-banner.unknown`), no green, no "Last activity" suffix.
2. Re-render on `data:unavailable`: `src/init.js` now subscribes `updateCreeksUI` to that event, so the age rule runs on the last known readings. `src/data/fetch.js` untouched.
3. Old reading keeps what it knew: "Old reading: 3 h ago it was 1600 cfs, 8.0x the 200 cfs minimum. The current level is unknown."; below minimum: "Old reading: 3 h ago it was 150 cfs, below the 200 cfs minimum. The current level is unknown."; unknown time: "Old reading: its time is unknown. The current level is unknown." The cfs number is formatted like the card (no thousands separator), the multiple uses the same truncation code as the fresh bands. Stays grey.
4. Red contrast: card status text and the veryhigh banner use `--accent-red-light`. A test reads the colours from theme.css and main.css and asserts at least 4.5:1 (worst case over bg-surface and bg-base): card green 9.08, amber 9.48, red 5.72; banner running 7.10, high 7.43, veryhigh 4.96, quiet and unknown 6.17. Before: card red 4.19, banner red 3.64.
5. Legend: "It mostly reflects how complete the inputs are (...). It also drops when the latest check against Little Falls was far off. It is not a measured error rate." in index.html, plan, README and CHANGELOG paraphrase, and appendix 5.9 (which now names the advisories that lower the label).
6. README hourly line now says a new prediction is stored only if no earlier one is still waiting to be checked.
7. `test/howitworks-text.test.mjs` no longer asserts a literal version: it compares the index.html title, CLAUDE.md, appendix (current version and footer), README and TODO with each other and requires a CHANGELOG row.
8. TODO.md: A9 follow-ups (untested display parts, 15 minute age re-check) and row A3j (three v39.2 production notes).
Test count after the amendments: 1140 total (1139 pass, 1 opt-in skip); 65 new tests in the two new files (54 + 11).

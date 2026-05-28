# Audit Report: v32.1 — 12h History + Junction Gap Fix

**Auditor**: Independent subagent (Claude)
**Date**: 2026-02-21
**Plan file**: `~/.claude/plans/prancy-crafting-matsumoto.md`
**Verdict**: **PASS** — all changes are display-only, correctly implemented, MINOR bump justified

---

## 1. Plan-vs-Implementation Verification

### Part 1: Extend History from 6h to 12h

| Plan Step | Expected | Actual (line) | Status |
|-----------|----------|---------------|--------|
| `computeGFHistoryFromPoR(6)` -> `(12)` | Line ~3172 | Line 3172: `computeGFHistoryFromPoR(12)` | PASS |
| `xMin = hasHistory ? -6 : 0` -> `-12` | Line ~3222 | Line 3222: `const xMin = hasHistory ? -12 : 0` | PASS |
| Header text "12H HISTORY" | Line ~672 | Line 672: `12H HISTORY + 48H FORECAST*` | PASS |
| X-axis labels updated | Lines ~3335-3337 | Lines 3336-3338: `-12h`, `-6h`, `Now`, `+12h`, `+24h`, `+36h`, `+48h` (wide); `Now`, `+12h`, `+24h`, `+48h` (narrow) | PASS (see note below) |

**Label deviation note**: Plan specified 9 wide-screen labels with 3-hour intervals (`-12h, -9h, -6h, -3h, Now, +12h, +24h, +36h, +48h`). Implementation uses 7 labels with 6-hour intervals for history (`-12h, -6h, Now, +12h, +24h, +36h, +48h`). This is a sensible simplification — 9 labels over a 350px+ graph would be crowded. Dropping `-9h` and `-3h` improves readability. **Not a defect.**

### Part 2: Fix Junction Gap

| Plan Step | Expected | Actual (lines) | Status |
|-----------|----------|-----------------|--------|
| Remove bridge to forecast NOW point | Remove `histPlusBridge` construction | Lines 3304-3322: No bridge. History line ends at last history data point. Comment: "no bridge to forecast NOW point" | PASS |
| History area fill from first to last history point | No bridging to xScale(0) | Line 3317: `histAreaPath` goes from `firstHistHrs` to `lastHistHrs`, then back along bottom — correctly bounded to history data only | PASS |

**Confirmed removed**: No occurrences of `histPlusBridge` or any bridge construction remain in the codebase.

---

## 2. Verification Checklist

### 2a. porHistory stores 72h of data — 12h is well within range
**PASS**. Line 1153: `const POR_HISTORY_MAX_AGE = 72 * 60 * 60 * 1000` (72 hours). The `computeGFHistoryFromPoR(12)` function (line 2102) filters by `cutoff = Date.now() - hoursBack * 3600000`, so 12h is comfortably within the 72h buffer. No cold-start issue for users who have been running the app for >12 hours.

### 2b. Bridge removal doesn't break forecast line rendering
**PASS**. Forecast line is built independently at lines 3295-3296:
```js
const fcstPathPoints = fcstData.map(d => `${xScale(d.hrs)},${yScale(d.stage)}`);
const fcstLinePath = fcstPathPoints.length > 0 ? `M ${fcstPathPoints.join(' L ')}` : '';
```
The forecast data is filtered via `forecastGraphData.filter(d => !d.isHistory)` (line 3292). It starts at hrs=0 (the NOW point) and extends to hrs=48. Completely independent of history data.

### 2c. Area fill for history correctly uses first-to-last history point
**PASS**. Lines 3315-3317:
```js
const firstHistHrs = histData[0].hrs;
const lastHistHrs = histData[histData.length - 1].hrs;
histAreaPath = `M ${xScale(firstHistHrs)},${yScale(histData[0].stage)} L ${histPathPoints.join(' L ')} L ${xScale(lastHistHrs)},${bottom} L ${xScale(firstHistHrs)},${bottom} Z`;
```
The area fill goes: first history point -> through all history points -> down to bottom at last history point -> back along bottom to first history point -> close. Correctly bounded. Does NOT bridge to `xScale(0)`.

### 2d. Tooltip domain correctly spans [-12, 48]
**PASS**. Line 3421:
```js
const hrs = Math.max(xMin, Math.min(xMax, ((x - padding.left) / graphWidth) * xRange + xMin));
```
Where `xMin = -12` (line 3222) and `xMax = 48` (line 3223). The tooltip clamps to `[-12, 48]`. The `forecastGraphData` array contains both history points (with `isHistory: true`, hrs from ~-12 to ~0) and forecast points (hrs 0 to 48), both pushed at lines 3231-3241 and 3273 respectively. The tooltip's `closest` lookup (line 3424) searches the full combined array.

### 2e. No changes to scheduled-update.js
**PASS**. Searched for "v32" in `/Users/sebjilke/Desktop/PotomacPulse/files/potomac-site/netlify/functions/scheduled-update.js` — zero matches. The server-side file contains no v32.x references and was not modified.

### 2f. MINOR version bump is correct
**PASS**. Both changes are display-only:
- Extending history from 6h to 12h: changes a constant passed to an existing function, widens x-axis range. No estimation logic touched.
- Bridge removal: changes SVG path construction for the history line. The forecast line and all estimation functions (`estimateGreatFalls`, `computeGFHistoryFromPoR`, logistic weights, power-law, etc.) are completely untouched.

Per versioning rules: "Bug fixes, UI changes, new tabs/features, documentation updates, display changes -- anything that doesn't alter the core estimation logic" = MINOR bump. v32.1 is correct.

---

## 3. Version Documentation

### index.html
- **Tech Appendix summary table** (line 6017): v32.1 row present with correct date (2026-02-21), unchanged model parameters (126 x EF^2.46, R=0.91), and accurate description. PASS.
- **Version History detail table** (line 6513): v32.1 entry present with thorough description of both changes (12h extension + junction gap fix). PASS.
- **Footer** (line 6555): `Generated by Potomac Pulse v32.1 -- 12h history + junction gap fix.` PASS.

### CLAUDE.md
- **Version header** (line 154): `## Current Model (v32.1) -- 12h History + Junction Gap Fix (2026-02-21)`. PASS.
- **History bullet** (lines 207-215): Updated from v31.3 to "v31.3 -> v32.1" with accurate description of both changes. Correctly notes `computeGFHistoryFromPoR(12)`, 72h backfill, removed bridge, display-only. PASS.

---

## 4. Potential Issues Assessment

### 4a. Visual gap between history end and forecast start
**MINOR COSMETIC, ACCEPTABLE**. After bridge removal, history ends at its last data point (a few minutes before NOW), and forecast starts at hrs=0. There will be a small temporal gap (typically 0-15 minutes depending on PoR data freshness). The green NOW dot at hrs=0 visually anchors the junction. This is a design improvement over the previous bridge, which created a steep jump line between mismatched models. The gap is honest -- it correctly represents that the two lines use different estimation methods.

### 4b. X-axis labels for 60h total range
**GOOD**. 7 labels on wide screens (-12h, -6h, Now, +12h, +24h, +36h, +48h) gives ~8.6h per label interval. On narrow screens, 4 labels (Now, +12h, +24h, +48h) avoids crowding. The `isNarrow` threshold at `graphWidth < 280` is reasonable. No overlap risk.

### 4c. Edge cases with empty or sparse history
**HANDLED**. The guard `const hasHistory = historyPoints.length >= 2` (line 3221) ensures:
- **Empty history** (cold start, <12h of data): `hasHistory = false`, `xMin = 0`, graph shows forecast only (48h range). No history line, no history area, no history dots. Labels revert to forecast-only set. CORRECT.
- **Sparse history** (2+ points but gaps): History line connects available points with straight segments. Dots appear at actual data points. The 15-minute PoR polling interval means 12h typically yields ~48 data points, but gaps from network outages or app closures are handled gracefully.
- **Single history point**: `hasHistory = false` (requires >= 2), so it's treated as no-history. CORRECT -- a single point can't show a trend.

### 4d. Forecast area fill overlap with history area fill
**NO ISSUE**. Forecast area fill (line 3301) starts at `xScale(0)` and goes to `xScale(48)`. History area fill (line 3317) goes from `xScale(firstHistHrs)` to `xScale(lastHistHrs)`. Since the last history point is slightly before hrs=0, there's a tiny gap at the bottom between the two fills. The history fill uses a dimmer opacity anyway (`rgba(96,165,250,0.05)` from v31.3), so even slight overlap would be invisible.

---

## 5. Summary

| Check | Result |
|-------|--------|
| `computeGFHistoryFromPoR(12)` | PASS |
| `xMin = -12` | PASS |
| Header "12H HISTORY" | PASS |
| X-axis labels (7 wide, 4 narrow) | PASS (minor deviation from plan's 9 labels -- improvement) |
| Bridge removed | PASS |
| History area correctly bounded | PASS |
| Tooltip domain [-12, 48] | PASS |
| porHistory 72h buffer sufficient | PASS |
| Forecast line independent | PASS |
| No changes to scheduled-update.js | PASS |
| MINOR version bump justified | PASS |
| Version tables updated | PASS |
| Footer updated | PASS |
| CLAUDE.md updated | PASS |
| Edge cases handled | PASS |

**Overall: PASS. v32.1 is correctly implemented per plan, with one minor label simplification that improves readability. No estimation logic touched. Safe to deploy.**

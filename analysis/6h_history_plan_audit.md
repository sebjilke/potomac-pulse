# Audit Report: Add 6-Hour History to Forecast Graph

**Plan file**: `/Users/sebjilke/.claude/plans/prancy-crafting-matsumoto.md`
**Auditor**: Independent subagent
**Date**: 2026-02-20
**Version target**: v31.3 (display-only, minor bump)

---

## Overall Assessment

The plan is well-structured, follows established patterns in the codebase (mirroring the `porHistory` infrastructure), and correctly scoped as a display-only change. However, several implementation details need attention — particularly around cold-start UX, the missed opportunity to reuse existing PoR history, and x-axis compression on mobile.

---

## Strengths

- **Follows existing patterns**: The `gfEstHistory` design directly mirrors the proven `porHistory` infrastructure (load/save/record/throttle/trim), minimizing risk of novel bugs.
- **Correctly scoped as display-only**: No changes to `estimateGreatFalls()` or `scheduled-update.js`. Version bump as minor (v31.3) is appropriate.
- **Throttle built in**: The 10-minute dedup guard prevents redundant entries — consistent with `recordPoRReading` behavior.
- **8-hour buffer beyond 6-hour display**: Keeping 8 hours of storage while displaying 6 provides a sensible buffer against clock drift and edge-case filtering.
- **No new cards**: Keeping the card row at Now/+6h/+12h/+24h/+48h avoids layout disruption. The graph alone communicates the trend.

---

## Concerns

### 1. Cold-Start UX Is Not Addressed (Important)

**Problem**: The plan acknowledges that "initially sparse, fills over time" (Verification point 2), but does not specify what the user sees on first load or after clearing localStorage. The graph would show a -6h to 0h region with zero or one data point, then a sudden jump to the forecast line. This looks like a rendering bug, not a feature.

**Unlike PoR history**, which has a USGS backfill mechanism (`backfillPoRHistory` at line 4883) that populates 72 hours of data from USGS time series on startup, there is **no equivalent backfill for GF estimates**. GF estimates are model outputs, not raw gauge readings — they cannot be fetched from USGS.

**Impact**: Every new visitor, every Safari private browsing session, and every localStorage-clear event produces a broken-looking graph. Given that mobile Safari in private mode discards localStorage on tab close, this affects a non-trivial user segment.

### 2. Missed Opportunity to Reuse PoR History (Important)

**Problem**: The plan creates an entirely new `gfEstHistory` localStorage store, but the existing `porHistory` already contains 72 hours of PoR readings, backfilled from USGS. Since `estimateGreatFalls()` is a deterministic function of current gauge readings, it is possible to **retroactively compute** GF estimates from historical PoR readings at display time.

**Specific approach**: For each `porHistory` entry in the last 6 hours, run the GF estimation formula (power-law + flow-dependent weights) using the stored PoR discharge. This would:
- Eliminate the cold-start problem entirely (72 hours of PoR data is always available after backfill)
- Remove the need for a new localStorage key and its associated storage/load/save/trim infrastructure
- Produce a denser, more accurate history line (PoR data goes back 72h with ~15-min resolution)

**Caveat**: This retroactive computation would use the *current* EF/tributary/LF readings for the weights, not the historical values. However, at the time-scales involved (6 hours), the flow-dependent weight function changes slowly enough that this approximation is reasonable. The PoR component dominates at 83.5% of the estimate anyway. Alternatively, the plan could store a lightweight `{ timestamp, cfs, stage }` record as proposed, but backfill it from PoR history on cold start using the simplified formula.

### 3. X-Axis Compression on Mobile (Important)

**Problem**: The current graph maps 48 hours to `graphWidth` pixels. At 350px viewport width, with 35px left padding and 10px right padding, `graphWidth` is ~305px. That gives 6.35 px/hour. Expanding to 54 hours gives 5.65 px/hour — an **11% compression** of the forecast portion.

More critically, the x-axis labels go from 5 labels (`Now, +12h, +24h, +36h, +48h`) to potentially 7 (`-6h, -3h, Now, +12h, +24h, +36h, +48h`). At 305px width, 7 labels yields ~44px per label, which will cause overlap at `font-size: 9px`.

**Recommendation**: On mobile (<500px), either (a) omit the `-6h` and `-3h` labels and only show the `Now` divider, or (b) reduce history to 3 hours on narrow screens.

### 4. `showTooltip` Hardcoded Domain [0, 48] (Important)

**Problem**: The `showTooltip` function (line 3292) converts mouse position to hours with:
```javascript
const hrs = Math.max(0, Math.min(48, ((x - padding.left) / graphWidth) * 48));
```

This clamps to `[0, 48]`. After the x-axis change to `[-6, 48]`, this must become:
```javascript
const hrs = Math.max(-6, Math.min(48, ((x - padding.left) / graphWidth) * 54 - 6));
```

The plan mentions "Keep the graph tooltip working for both past and future points" but does not call out this specific formula change. If missed, the tooltip will be offset by 6 hours for the entire graph and will never resolve to negative hours.

### 5. `showGraphMarker` Assumes Non-Negative Hours (Important)

**Problem**: The `showGraphMarker` function (line 3323) is called when a forecast card is clicked. Cards use `data-hrs` attributes (0, 6, 12, 24, 48). This function will work unchanged because card hrs values are all >= 0. However, if the tooltip or any future interaction passes a negative hour value, the marker lookup logic at line 3332:
```javascript
const dataPoint = forecastGraphData.find(d => d.hrs === hrs)
```
needs `forecastGraphData` to include negative-hour entries. The plan says "prepend history points to `forecastGraphData[]`" — this must be done **before** `renderForecastGraph` builds its path, and the data must use the same `{ hrs, time, cfs, stage }` structure.

### 6. Area Fill Path Starts at x=0, Not at x=-6 (Minor)

**Problem**: The area fill path (line 3230) is currently:
```javascript
const areaPath = `M ${xScale(0)},${yScale(forecastGraphData[0].stage)} L ${pathPoints.join(' L ')} L ${xScale(48)},${bottom} L ${xScale(0)},${bottom} Z`;
```

After the change, this needs to start at `xScale(-6)` (or wherever the first history point is). If history is empty, it should start at `xScale(0)`. The plan doesn't mention this path adjustment.

### 7. No CI Bands for History (Minor)

**Problem**: The current graph does not render CI bands (the empirical 90% CI is displayed as text on the main card, not as a shaded region on the graph). So this is not a concern for visual consistency. However, the plan should explicitly note that history points have no CI — they are past estimates with known outcomes. If CI bands are ever added to the graph, history should be excluded.

### 8. Gradient ID Collision (Minor)

**Problem**: The SVG gradient (line 3269) uses `id="graphGradient"`. If the history portion uses a different fill treatment (the plan suggests "solid white/blue line" for history vs green for forecast), a second gradient definition may be needed. More importantly, if history and forecast use different area fills, the single `<path d="${areaPath}" .../>` must be split into two paths with a break at `x=0`.

### 9. localStorage Quota Is Not a Concern (Minor — No Action)

32 entries at ~50 bytes each = ~1.6 KB. Even with 8 hours of 15-min data (~32 entries), this is trivially small compared to the existing `porHistory` (72 hours * 4 entries/hour = ~288 entries, ~14 KB). No localStorage quota issues.

### 10. Timezone / DST Edge Case (Minor)

**Problem**: The plan uses `Date.now()` for timestamps, which is UTC-based. This is correct. However, the display of `-6h, -3h` labels and the tooltip time display (`formatForecastTime`) use local time. During a DST transition, the labels could show a confusing jump (e.g., history shows 1:45am, 1:00am, 1:15am in fall-back). This is an edge case affecting ~2 hours/year and is acceptable. No action required.

---

## Recommendations

### R1. Implement retroactive GF computation from PoR history (replaces Steps 1-2)

Instead of creating new `gfEstHistory` storage, compute historical GF estimates on-the-fly from the existing `porHistory` array. In `updateForecastPeriods`, before calling `renderForecastGraph`:

```javascript
const historyPoints = [];
const sixHoursAgo = Date.now() - 6 * 3600000;
for (const entry of porHistory) {
    if (entry.timestamp >= sixHoursAgo) {
        // Simplified GF estimate from PoR alone (power-law, no EF/tributary data for past)
        const gfFromPor = estimateGFFromPoR(entry.cfs); // New lightweight function
        const hrsAgo = (Date.now() - entry.timestamp) / 3600000;
        historyPoints.push({
            hrs: -hrsAgo,
            cfs: gfFromPor.cfs,
            stage: gfFromPor.stage,
            time: new Date(entry.timestamp),
            isHistory: true
        });
    }
}
```

**Advantages**: Zero cold-start delay, no new localStorage key, no new load/save/trim code, leverages the USGS backfill that already exists.

**If this approach is rejected** (e.g., because retroactive estimates without EF data are too inaccurate), then proceed with the plan's `gfEstHistory` approach but add explicit cold-start handling: (a) show only the forecast portion until >= 3 history points exist, and (b) display a subtle "History accumulating..." note in the -6h region.

### R2. Fix `showTooltip` domain explicitly

The plan must call out the formula change in `showTooltip` (line 3292). Add to the plan:
> In `showTooltip`, change the hour calculation from `[0, 48]` domain to `[-6, 48]`:
> `const hrs = ((x - padding.left) / graphWidth) * 54 - 6;`
> Clamp to `[-6, 48]`.

### R3. Specify the area fill path split at NOW

The area fill should be split into two paths:
- History portion: `xScale(firstHistoryHr)` to `xScale(0)` — use a different fill (e.g., `opacity="0.15"` or a gray gradient) to visually distinguish.
- Forecast portion: `xScale(0)` to `xScale(48)` — existing green gradient.

If history is empty, only render the forecast area fill starting at `xScale(0)`.

### R4. Limit x-axis labels on mobile

Add a responsive check: if `graphWidth < 280`, show only `Now, +12h, +24h, +48h` labels (drop `-6h`, `-3h`, `+36h`). This prevents label overlap at narrow widths.

### R5. Consider 3-hour history as alternative

6 hours of history is generous but compresses the forecast significantly. 3 hours of history (with 15-min resolution = ~12 points) may be sufficient to show the recent trend while keeping the forecast portion nearly full-width. The x-axis ratio would be 51:54 vs 48:54, a much smaller compression. Worth considering as a middle ground, especially for mobile.

### R6. Add visual treatment for "NOW" divider in the plan

The plan mentions a "thin vertical dashed line at x=0 with NOW label" but should specify:
- Line color (suggest `#f59e0b` amber or `#94a3b8` slate — NOT green, which would blend with the forecast line)
- Z-ordering (the NOW line should render above the area fill but below the tooltip)
- Label position (above the graph area or at the bottom with x-axis labels?)

### R7. Handle the "current point marker" relocation

The existing `<circle cx="${xScale(0)}" .../>` at line 3256 is the green dot marking "Now" on the graph. After the change, this dot sits at the junction of history and forecast lines. The plan should explicitly state that this dot remains at `xScale(0)` and serves as the visual anchor between the two line segments. If the history line connects to this dot, the rendering must ensure continuity (no gap between the last history point and the "Now" dot).

---

## Verdict

**APPROVE WITH CHANGES**

The plan is fundamentally sound and correctly scoped. The concerns are all addressable without architectural changes. The most impactful recommendation is R1 (reuse PoR history) which would eliminate the cold-start problem and reduce implementation complexity. If R1 is rejected for accuracy reasons, the plan should at minimum add explicit cold-start UX handling. Recommendations R2 (tooltip fix) and R3 (area fill split) are mandatory — without them the implementation will have visible bugs.

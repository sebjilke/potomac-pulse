# Audit Report: Flow State Classification Fix (v32.0)

**Auditor**: Independent subagent
**Date**: 2026-02-21
**Plan file**: `/Users/sebjilke/.claude/plans/prancy-crafting-matsumoto.md`
**Scope**: One-line change at `index.html` line 2397 to prefer observed PoR rate over NWS forecast for flow state classification

---

## Overall Assessment

The plan is **well-scoped, low-risk, and correctly motivated**. The client-side `getFlowState()` currently uses NWS forecast data (`por.trend`) which can disagree with the actual observed river state, causing misclassified correction bins and uncertainty lookups. The proposed fix reuses an existing, already-tested function (`getPoRRiseRate()`) with a clean fallback. The server already does exactly this, so the change brings client-server parity.

---

## Verification Results

### Claim 1: "Thresholds are identical between `getPoRRiseRate()` and `getFlowState()`"

**PARTIALLY TRUE -- with a nuance.**

The *intent* is identical (`max(100, flow * 0.02)`), but the implementations differ slightly:

| Function | Code | Effective threshold |
|----------|------|-------------------|
| `getPoRRiseRate()` (client, line 2081) | `Math.max(100, currentCFS * 0.02)` | `max(100, flow * 0.02)` |
| `getFlowState()` (client, line 2189) | `Math.max(minAbsChange, (currentFlow \|\| 5000) * minPctChange / 100)` where `minAbsChange=100`, `minPctChange=2` | `max(100, flow * 0.02)` or `max(100, 5000*0.02)=100` if flow is falsy |
| `getFlowState()` (server, line 380) | `Math.max(minAbsChange, currentCFS * minPctChange)` where `minAbsChange=100`, `minPctChange=0.02` | `max(100, flow * 0.02)` |

All three produce `max(100, flow * 0.02)` when flow is truthy. The client `getFlowState()` has a `(currentFlow || 5000)` fallback for null/zero flow, but `getPoRRiseRate()` would already return `null` before reaching its threshold check if `porHistory` has insufficient data. **Thresholds are functionally identical for all realistic cases.** Confirmed.

### Claim 2: "`riseRate` is already computed at line 2275 and in scope"

**TRUE.** `const riseRate = getPoRRiseRate()` is assigned at line 2275 within `estimateGreatFalls()`. The proposed change at line 2397 is also within `estimateGreatFalls()`. Both are in the same function scope. `riseRate` is used downstream at lines 2137-2164 (wave celerity) and 2540-2543 (diagnostics) without issue. Confirmed.

### Claim 3: "The server already uses observed data (not NWS)"

**TRUE.** Server-side `getFlowState()` at line 355 of `scheduled-update.js` takes `(history, currentCFS)` and iterates over a PoR history array with 2-hour lookback. It is called at line 469 as `getFlowState(porHistory, por.q)`. The server has no NWS dependency for flow state. Confirmed.

### Claim 4: "MAJOR version bump because it changes estimation output"

**TRUE.** `flowState` directly feeds into:
- `getGFCorrection(flowBin, flowState)` at line 2401 -- adjusts the CFS estimate
- `getGFUncertainty(flowBin, flowState)` at line 2402 -- adjusts confidence intervals
- EF cross-check at line 2500 -- affects confidence level
- Learning bin lookup at line 2756 -- UI display

Since corrections and uncertainty bands change the numeric output for the same inputs, this is a MAJOR version bump per the project's versioning rules. Confirmed.

### Claim 5: "NWS-based `getFlowState()` becomes the cold-start fallback"

**TRUE.** The proposed code `(riseRate && riseRate.flowState) ? riseRate.flowState : getFlowState(por.trend, por.q)` falls back to NWS when `riseRate` is null (i.e., `porHistory.length < 4` or no reading found 2+ hours ago). Confirmed.

### Claim 6: "No changes to `scheduled-update.js`"

**TRUE.** The server already uses observed history. No changes needed. Confirmed.

---

## Concerns

### 1. Threshold Comparison Uses Different Flow Values (Minor)

`getPoRRiseRate()` computes `threshold = Math.max(100, currentCFS * 0.02)` where `currentCFS = porHistory[porHistory.length - 1].cfs` (the most recent PoR *history* entry). The old `getFlowState()` used `por.q` (the *live* PoR reading from the current USGS fetch). These are almost always the same value (within minutes of each other), but during very fast rises they could differ by tens of CFS. **Impact: negligible.** The threshold difference would be on the order of single CFS.

**Severity: Minor**

### 2. Oscillation Risk: 2-Hour Observed Window vs 48-Hour NWS Window (Important)

The NWS 48-hour forecast naturally smooths state transitions: a river forecast to rise and fall within 48 hours reads as "steady" (no net change). The observed 2-hour window is much more reactive. During oscillating conditions (e.g., dam releases, tidal influence near LF, or choppy storm pulses), the observed flow state could flip between rising/falling/steady on successive 15-minute update cycles.

**Mitigating factors:**
- The `max(100, 2%)` threshold provides meaningful deadband
- At baseflow (~5,000 cfs), a 100 CFS change in 2 hours is required -- genuine hydrologic signal
- The 2-hour lookback (not 15-minute) smooths short pulses
- The server already uses this exact logic and has been running without oscillation issues

**But:** The plan does not address what happens to the *display* during rapid state changes. The UI shows "RISING"/"FALLING"/"STEADY" -- if this flickers on successive refreshes, it could confuse users even if the estimation impact is minimal.

**Severity: Important** (cosmetic, not correctness)

### 3. `porHistory` Backfill Timestamps vs `Date.now()` (Important)

`getPoRRiseRate()` computes `twoHoursAgo = now - 2h` using `Date.now()`. Backfilled entries from `backfillPoRHistory()` (line 5009) use USGS timestamps (`new Date(reading.dateTime).getTime()`), which are *observation* timestamps, not browser-local timestamps. This is correct behavior -- USGS timestamps represent when the water was measured. However:

If a user opens the app after their browser has been closed for days, `backfillPoRHistory()` fills in USGS 7-day data with correct historical timestamps. On the first call to `estimateGreatFalls()`:
1. `porHistory` has many entries (backfilled)
2. `getPoRRiseRate()` finds a reading at `twoHoursAgo` using USGS timestamps
3. The "current" reading is the most recent USGS reading, which might be 15-30 minutes old
4. This produces a valid `riseRate` reflecting the actual observed rise rate

This is **correct and desirable** -- the rate reflects what the river actually did. No concern here after analysis.

**Severity: Minor** (initially flagged as Important, downgraded after analysis)

### 4. `riseRate.flowState` Cannot Be `undefined` (Verified Safe)

The plan's proposed guard `(riseRate && riseRate.flowState)` checks for:
- `riseRate === null` (insufficient history) -- handled, falls back to NWS
- `riseRate.flowState` falsy -- never happens in practice

Looking at `getPoRRiseRate()` (lines 2082-2085): `flowState` is initialized to `'steady'` and only changes to `'rising'` or `'falling'`. It is **always a truthy string** when `riseRate` is not null. The guard `riseRate.flowState` being falsy (empty string, `undefined`) cannot occur given the current implementation.

However, the guard `(riseRate && riseRate.flowState)` would incorrectly fall through to NWS if `flowState === ''` (empty string). Since this cannot happen, it is safe. But a stricter check like `riseRate?.flowState != null` would be marginally more defensive.

**Severity: Minor**

### 5. Race Condition: `porHistory` Population vs `estimateGreatFalls()` (Minor)

The execution order is:
1. `init()` calls `loadPoRHistory()` (line 5672) -- loads from localStorage
2. `init()` calls `fetchData()` (line 5693) -- fetches USGS, calls `backfillPoRHistory()` (line 4990), then `recordPoRReading()` (line 2269 inside `estimateGreatFalls()`), then `getPoRRiseRate()` (line 2275)

Since JavaScript is single-threaded and `fetchData()` is awaited, `loadPoRHistory()` always completes before `estimateGreatFalls()` runs. There is no race condition. The only scenario where `porHistory` could be sparse is a genuine cold start (no localStorage), which is correctly handled by the `riseRate === null` fallback.

**Severity: Minor** (no actual race condition exists)

### 6. Missing Diagnostic Logging for Fallback Path (Minor)

The plan mentions adding a `console.log` after flowState (Step 3), but doesn't specify the format. It would be helpful to log which path was taken (observed vs NWS fallback) and why, similar to the existing wave celerity logging. Without this, debugging "why did it show STEADY during a rise" becomes harder.

**Severity: Minor**

---

## Recommendations

### 1. Add Explicit Logging for Both Paths (Accept from plan Step 3, with specifics)

```javascript
const flowState = (riseRate && riseRate.flowState) ? riseRate.flowState : getFlowState(por.trend, por.q);
if (riseRate && riseRate.flowState) {
    console.log(`📊 Flow state: ${flowState} (observed, ${riseRate.changeCFS > 0 ? '+' : ''}${Math.round(riseRate.changeCFS)} cfs over ${riseRate.hoursDiff.toFixed(1)}h)`);
} else {
    console.log(`📊 Flow state: ${flowState} (NWS fallback, porHistory has ${porHistory.length} entries)`);
}
```

This makes it immediately clear in the console which code path is active and why.

### 2. No Hysteresis Needed (Informational)

I considered recommending a hysteresis mechanism (e.g., require N consecutive "rising" readings before switching from "steady" to "rising") to prevent display oscillation. However:
- The 2-hour lookback already provides significant smoothing
- The server has been running this exact logic without issues
- Adding hysteresis would create a new client-server divergence
- The `max(100, 2%)` threshold is already a meaningful deadband

Do **not** add hysteresis. The current design is sufficient.

### 3. Consider Null-Safe Property Access (Optional)

Replace `(riseRate && riseRate.flowState)` with `riseRate?.flowState` for conciseness:

```javascript
const flowState = riseRate?.flowState || getFlowState(por.trend, por.q);
```

This is functionally identical (since `flowState` is always `'rising'`/`'falling'`/`'steady'` when riseRate is non-null) and more idiomatic. Optional -- the plan's version is also correct.

### 4. Verify Browser Behavior During State Transition (Accept from plan Step 5)

The plan already includes browser verification via Chrome MCP tools. During this step, specifically check:
- Open the app and confirm flow state matches the server's assessment
- If possible, observe a natural state transition (or simulate by clearing localStorage and letting backfill populate)
- Confirm the console log shows "observed" path after ~1 hour of history accumulates

---

## Verdict

**APPROVE**

The plan is sound, the fix is minimal and well-targeted, all claims are verified, and the fallback behavior is robust. The one-line change brings the client into parity with the server, fixes a real user-visible bug (showing "STEADY" during observed rises), and improves correction bin / uncertainty lookups.

The concerns identified are all Minor or Important-but-cosmetic. No Critical issues found. The recommendations above are quality-of-life improvements, not blockers.

Proceed with implementation as planned.

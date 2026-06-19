// Potomac Pulse — Data fetching, processing, caching, and utility functions
// Extracted from index.html inline script

import {
    LF, CACHE_KEY, CACHE_MAX_AGE, GAUGES, EDWARDS_FERRY,
    EF_MODEL, EF_HISTORY_MAX, MEDIAN_FLOW,
    POR_HISTORY_MAX_AGE, CREEK_RUNS
} from '../model/constants.js';

import {
    getFlowMultiplier, estimateLFStage
} from '../model/shared-model.js';

import {
    data, setData,
    dataSource, setDataSource,
    lastFetchTime, setLastFetchTime,
    isFetching, setIsFetching,
    edwardsFerryData,
    waterTempC, setWaterTempC,
    creekData,
    porHistory, setPorHistory,
    errorBannerTimeout, setErrorBannerTimeout
} from '../state/store.js';

import { fetchNWSForecasts } from '../estimation/nws.js';
import { fetchEdwardsFerry, fetchWaterTemp } from '../estimation/edwards-ferry.js';
import { emit } from '../state/event-bus.js';

// ==================== CORE FUNCTIONS ====================

// Validate USGS API response schema
/**
 * Validates that a parsed USGS IV API response has the expected schema (object with a value.timeSeries array, each series carrying siteCode and variableCode).
 * @param {Object} json - The parsed JSON response from the USGS waterservices API.
 * @returns {boolean} True if the response is structurally valid, false otherwise.
 */
export function validateUSGSResponse(json) {
    if (!json || typeof json !== 'object') {
        console.error('USGS validation: Response is not an object');
        return false;
    }
    if (!json.value) {
        console.error('USGS validation: Missing "value" property');
        return false;
    }
    if (!Array.isArray(json.value.timeSeries)) {
        console.error('USGS validation: "value.timeSeries" is not an array');
        return false;
    }
    // Validate each time series has required fields
    for (let i = 0; i < json.value.timeSeries.length; i++) {
        const ts = json.value.timeSeries[i];
        if (!ts.sourceInfo?.siteCode?.[0]?.value) {
            console.error(`USGS validation: timeSeries[${i}] missing sourceInfo.siteCode`);
            return false;
        }
        if (!ts.variable?.variableCode?.[0]?.value) {
            console.error(`USGS validation: timeSeries[${i}] missing variable.variableCode`);
            return false;
        }
    }
    return true;
}

// Fetch with timeout wrapper (default 5 seconds)
/**
 * Performs a fetch that aborts and throws if the request exceeds the given timeout.
 * @param {string} url - The URL to fetch.
 * @param {number} [timeoutMs=5000] - Timeout in milliseconds before the request is aborted.
 * @returns {Promise<Response>} The fetch Response if it completes before the timeout.
 */
export async function fetchWithTimeout(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw error;
    }
}

// ==================== DATA CACHING ====================

/**
 * Stores the USGS JSON in localStorage along with the current timestamp for later cache retrieval.
 * @param {Object} json - The USGS response data to cache.
 */
export function saveToCache(json) {
    try {
        const cacheData = {
            timestamp: Date.now(),
            data: json
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));
        console.log('💾 Saved data to cache');
    } catch(e) {
        console.log('Cache save failed:', e);
    }
}

/**
 * Reads the cached USGS data from localStorage and reports its age and staleness.
 * @returns {{data: Object, timestamp: number, age: number, stale: boolean}|null} The cached payload with metadata, or null if no cache exists or parsing fails.
 */
export function loadFromCache() {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return null;

        const { timestamp, data: cachedData } = JSON.parse(cached);
        const age = Date.now() - timestamp;

        const isStale = age > CACHE_MAX_AGE;
        if (isStale) {
            console.log('💾 Cache is stale (>6 hours old)');
        }

        console.log(`💾 Using cached data (${Math.round(age / 60000)} min old)`);
        return { data: cachedData, timestamp, age, stale: isStale };
    } catch(e) {
        console.log('Cache load failed:', e);
        return null;
    }
}

// ==================== TRAVEL TIME CALCULATION ====================

/**
 * Computes flow-dependent travel times, arrival times, and multipliers for each gauge (except Little Falls) and writes them onto the shared `data` object.
 */
export function calcTravelTimes() {
    // Use Little Falls FLOW for multiplier (Searcy power law)
    const lfFlow = data[LF.id]?.q || MEDIAN_FLOW;
    const multInfo = getFlowMultiplier(lfFlow);
    data._mult = multInfo;

    for (const [id, g] of Object.entries(GAUGES)) {
        if (id === LF.id) continue;

        const d = data[id];
        if (!d) continue;

        // Travel time from flow-based multiplier (Searcy power law)
        const travelHrs = g.baseHrs * multInfo.mult;

        d.travelHrs = travelHrs;
        d.baseHrs = g.baseHrs;
        d.mult = multInfo.mult;
        d.arrival = new Date(Date.now() + travelHrs * 3600000);
        d.pctLF = g.pctLF;
    }
}

// ==================== DATA PROCESSING ====================

// Process USGS JSON into the `data` object (no UI update)
/**
 * Parses USGS time series into the shared `data` object (discharge/stage per site, with ice-flag handling), backfills PoR history, fills missing gauges, and recomputes travel times.
 * @param {Object} json - The validated USGS IV API response.
 */
export function processData(json) {
    setData({});
    if (!json?.value?.timeSeries) return;

    // Track PoR time series for history backfill
    let porTimeSeries = null;

    for (const ts of json.value.timeSeries) {
        const s = ts.sourceInfo.siteCode[0].value;
        const p = ts.variable.variableCode[0].value;
        const values = ts.values[0]?.value;
        if (!data[s]) data[s] = {};

        // Capture PoR discharge time series for history backfill
        if (s === "01638500" && p === "00060" && values?.length) {
            porTimeSeries = values;
        }

        if (values?.length) {
            // Get current value (most recent)
            const latest = values[values.length-1];
            const n = parseFloat(latest.value);
            const qualifiers = latest.qualifiers || [];
            const isIceFlag = n <= -999999 || qualifiers.includes('Ice');

            if (n > 0 && n < 9999999) {
                // Valid current reading
                if (p === "00060") data[s].q = n;
                if (p === "00065") data[s].h = n;
            } else if (isIceFlag && p === "00060") {
                // Ice-flagged discharge: find last valid reading in time series
                let foundValid = false;
                for (let i = values.length - 2; i >= 0; i--) {
                    const val = parseFloat(values[i].value);
                    if (val > 0 && val < 9999999) {
                        data[s].q = val;
                        data[s].iceAffected = true;
                        data[s].lastValidTime = new Date(values[i].dateTime).getTime();
                        console.log(`🧊 ${s}: Ice-flagged, using last valid: ${val} cfs from ${values[i].dateTime}`);
                        foundValid = true;
                        break;
                    }
                }
                // If no valid reading in 2-day window, still mark as ice-affected
                if (!foundValid) {
                    data[s].iceAffected = true;
                    data[s].iceLongTerm = true;
                    console.log(`🧊 ${s}: Ice-flagged for >2 days, no valid readings in window`);
                }
            }
        }
    }

    // Backfill PoR history from USGS 7-day time series
    if (porTimeSeries) {
        backfillPoRHistory(porTimeSeries);
    }

    // Fill in missing gauges with estimates
    fillMissingData();

    calcTravelTimes();
}

// Backfill PoR history from USGS time series data
/**
 * Backfills the Point-of-Rocks discharge history from a USGS time series, deduplicating into 10-minute buckets, pruning entries older than the max age, and persisting to localStorage.
 * @param {Array<Object>} timeSeries - Array of USGS reading objects, each with `dateTime` and `value` fields.
 */
export function backfillPoRHistory(timeSeries) {
    if (!timeSeries?.length) return;

    const existingTimestamps = new Set(porHistory.map(e => Math.floor(e.timestamp / 600000))); // 10-min buckets
    let added = 0;

    for (const reading of timeSeries) {
        const timestamp = new Date(reading.dateTime).getTime();
        const bucket = Math.floor(timestamp / 600000);

        // Skip if we already have a reading in this 10-minute bucket
        if (existingTimestamps.has(bucket)) continue;

        const cfs = parseFloat(reading.value);
        if (!cfs || cfs <= 0 || cfs > 500000) continue;

        porHistory.push({
            timestamp: timestamp,
            cfs: cfs,
            stage: null
        });
        existingTimestamps.add(bucket);
        added++;
    }

    if (added > 0) {
        // Sort by timestamp and remove old entries
        porHistory.sort((a, b) => a.timestamp - b.timestamp);
        const cutoff = Date.now() - POR_HISTORY_MAX_AGE;
        setPorHistory(porHistory.filter(entry => entry.timestamp > cutoff));
        // savePoRHistory imported from history module would create circular dep
        // so we call it via the history module import at the top
        try {
            localStorage.setItem('potomac_por_history', JSON.stringify(porHistory));
        } catch(e) { /* ignore */ }
        console.log(`📊 Backfilled ${added} PoR history entries from USGS, total: ${porHistory.length}`);
    }
}

/**
 * Estimates missing per-gauge discharge values from the Little Falls flow scaled by drainage-area ratio, marking them as estimated; does not fabricate stage.
 */
export function fillMissingData() {
    // Get Little Falls and Point of Rocks as reference
    const lfQ = data[LF.id]?.q;

    for (const [id, g] of Object.entries(GAUGES)) {
        if (id === LF.id) continue;
        if (!data[id]) data[id] = {};

        // Estimate missing discharge from drainage area ratio (defensible approximation).
        if (!data[id].q && lfQ) {
            data[id].q = Math.round(lfQ * (g.area / 11560));
            data[id].estimated = true;
        }

        // (C49) Do NOT fabricate stage. Point-of-Rocks stage is a different river reach
        // and datum; copying it to other gauges produced a physically meaningless number.
        // Leave a missing stage as missing — the UI shows "n/a".
    }
}

// ==================== FETCH CREEK DATA ====================

/**
 * Fetches discharge data for all configured creek run gauges from USGS, computing trend, runnable status, and hourly history, and writes results into the shared `creekData` object.
 * @returns {Promise<void>} Resolves when the fetch and processing complete; failures are caught and logged.
 */
export async function fetchCreekData() {
    const sites = Object.keys(CREEK_RUNS).join(',');
    const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${sites}&parameterCd=00060&period=P1D&format=json`;
    try {
        const r = await fetchWithTimeout(url, 5000);
        if (!r.ok) return;
        const json = await r.json();
        if (!json?.value?.timeSeries) return;

        for (const ts of json.value.timeSeries) {
            const siteCode = ts.sourceInfo?.siteCode?.[0]?.value;
            if (!siteCode || !CREEK_RUNS[siteCode]) continue;
            const paramCode = ts.variable?.variableCode?.[0]?.value;
            if (paramCode !== '00060') continue;

            const values = ts.values?.[0]?.value;
            if (!values?.length) continue;

            const latest = values[values.length - 1];
            const q = parseFloat(latest.value);
            if (isNaN(q) || q < 0) continue;

            // Compute trend from last ~2 hours of readings
            let trend = 'steady';
            if (values.length >= 8) {
                const twoHoursAgo = parseFloat(values[Math.max(0, values.length - 9)].value);
                if (!isNaN(twoHoursAgo) && twoHoursAgo > 0) {
                    const pctChange = ((q - twoHoursAgo) / twoHoursAgo) * 100;
                    if (pctChange > 10) trend = 'rising';
                    else if (pctChange < -10) trend = 'falling';
                }
            }

            // Build hourly history (thin 15-min readings to hourly)
            const history = [];
            for (let i = 0; i < values.length; i += 4) {
                const v = values[i];
                const hq = parseFloat(v.value);
                if (hq >= 0) history.push({ time: new Date(v.dateTime), q: hq });
            }
            // Always include the latest reading at the end
            if (history.length === 0 || history[history.length - 1].time.getTime() !== new Date(latest.dateTime).getTime()) {
                history.push({ time: new Date(latest.dateTime), q });
            }

            creekData[siteCode] = {
                q: q,
                trend: trend,
                time: new Date(latest.dateTime),
                running: q >= CREEK_RUNS[siteCode].runnable,
                history: history
            };

            if (q >= CREEK_RUNS[siteCode].runnable) {
                try { localStorage.setItem(`creek_lastran_${siteCode}`, new Date().toISOString()); } catch(e) {}
            }
        }
        console.log(`🏞️ Creek data: ${Object.keys(creekData).length}/${Object.keys(CREEK_RUNS).length} gauges loaded`);
    } catch(e) {
        console.warn('Creek data fetch failed:', e);
    }
}

// ==================== MAIN FETCH ====================

const PROXIES_LIST = [
    "https://api.allorigins.win/raw?url=",
    "https://corsproxy.io/?"
];

/**
 * Top-level data refresh: fetches USGS gauge data (direct, then proxies, then cache fallback) in parallel with Edwards Ferry, water temp, and creek data, processes it, updates status, emits render events, and kicks off the background NWS forecast fetch.
 * @returns {Promise<void>} Resolves when the synchronous fetch/process pipeline completes (NWS forecast continues in the background).
 */
export async function fetchData() {
    if (isFetching) return;
    setIsFetching(true);
    try {
    setStatus("loading");
    const sites = Object.keys(GAUGES).join(",");
    const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${sites}&parameterCd=00060,00065&period=P7D&format=json`;

    /**
     * Attempts to fetch and validate USGS data directly, then via each CORS proxy, falling back to cached data if all network attempts fail; updates fetch time and data source accordingly.
     * @returns {Promise<Object|null>} The validated USGS JSON (live or cached), or null if no data is available.
     */
    async function fetchUSGS() {
        try {
            let r = await fetchWithTimeout(url, 10000);
            if (r.ok) {
                const json = await r.json();
                if (validateUSGSResponse(json)) {
                    saveToCache(json);
                    setLastFetchTime(Date.now());
                    setDataSource("live");
                    return json;
                }
                console.log('USGS response validation failed, trying proxies...');
            }
        } catch(e) {
            console.log('Direct USGS fetch failed:', e.message || e);
        }

        for (const p of PROXIES_LIST) {
            try {
                let r = await fetchWithTimeout(p + encodeURIComponent(url), 5000);
                if (r.ok) {
                    const json = await r.json();
                    if (validateUSGSResponse(json)) {
                        saveToCache(json);
                        setLastFetchTime(Date.now());
                        setDataSource("live");
                        return json;
                    }
                    console.log(`Proxy ${p} returned invalid USGS response`);
                }
            } catch(e) {
                console.log('Proxy fetch failed:', e);
            }
        }

        const cached = loadFromCache();
        if (cached) {
            setLastFetchTime(cached.timestamp);
            setDataSource(cached.stale ? "stale" : "cached");
            return cached.data;
        }
        return null;
    }

    const [usgsJson] = await Promise.all([
        fetchUSGS(),
        fetchEdwardsFerry(),
        fetchWaterTemp(),
        fetchCreekData()
    ]);

    if (!usgsJson) {
        console.log('⚠️ No data available - no cache exists');
        setLastFetchTime(null);
        setDataSource("unavailable");
        setStatus("error");
        emit('data:unavailable');
        return;
    }

    processData(usgsJson);

    // Render immediately with USGS + EF data; the forecast/trends use NWS, which is fetched in the
    // background and triggers a re-render via 'nws:arrived' when it lands (v37.4 — replaces the old 4s
    // Promise.race render gate). 'data:unavailable' / 'data:updated' / 'nws:arrived' are all wired in init.js.
    setStatus(dataSource === "live" ? "ok" : (dataSource === "stale" ? "stale" : "cached"));
    emit('data:updated');

    fetchNWSForecasts()
        .then(() => {
            console.log('📡 NWS arrived — re-rendering forecast');
            emit('nws:arrived');
        })
        .catch(e => console.warn('NWS forecast fetch error:', e));

    } finally {
        setIsFetching(false);
    }
}

// ==================== STATUS & UI UTILITIES ====================

/**
 * Updates the status indicator dot, status text, refresh button state, and error banner to reflect the current connection/data state.
 * @param {string} s - The status: "loading", "ok", "cached", "stale", or "error".
 */
export function setStatus(s) {
    const dot = document.getElementById("dot");
    const st = document.getElementById("status");
    const refreshBtn = document.getElementById("refreshBtn");

    if (refreshBtn) {
        if (s === "loading") {
            refreshBtn.disabled = true;
            refreshBtn.classList.add("loading");
        } else {
            refreshBtn.disabled = false;
            refreshBtn.classList.remove("loading");
        }
    }

    if (s === "loading") {
        dot.className = "dot loading";
        dot.title = "Fetching data from USGS...";
        st.textContent = "Fetching data...";
    } else if (s === "ok") {
        dot.className = "dot";
        dot.title = "Live - Connected to USGS";
        st.textContent = "Live";
        dismissErrorBanner();
    } else if (s === "cached") {
        dot.className = "dot cached";
        dot.title = "Cached - Using stored data";
        st.textContent = "Cached";
    } else if (s === "stale") {
        dot.className = "dot error";
        dot.title = "Offline - Using old cached data";
        st.textContent = "Offline";
        showErrorBanner("Network unavailable. Showing cached data.");
    } else if (s === "error") {
        dot.className = "dot error";
        dot.title = "No data available";
        st.textContent = "No Data";
        showErrorBanner("Unable to connect to USGS. Check your connection.");
    }

    updateStalenessDisplay();
}

/**
 * Displays the error banner with an optional message and schedules it to auto-dismiss after 10 seconds.
 * @param {string} [msg] - The error message to show; if omitted, the existing banner text is kept.
 */
export function showErrorBanner(msg) {
    const b = document.getElementById('error-banner');
    if (msg) document.getElementById('error-banner-text').textContent = msg;
    b.style.display = 'flex';
    if (errorBannerTimeout) clearTimeout(errorBannerTimeout);
    setErrorBannerTimeout(setTimeout(dismissErrorBanner, 10000));
}

/**
 * Hides the error banner and clears any pending auto-dismiss timeout.
 */
export function dismissErrorBanner() {
    document.getElementById('error-banner').style.display = 'none';
    if (errorBannerTimeout) { clearTimeout(errorBannerTimeout); setErrorBannerTimeout(null); }
}

/**
 * Updates the "last updated" UI element with a human-readable age (e.g. "just now", "5m ago") and a freshness CSS class based on time since the last successful fetch.
 */
export function updateStalenessDisplay() {
    const el = document.getElementById("lastUpdate");
    if (!el) return;

    if (!lastFetchTime) {
        el.textContent = "No data";
        el.className = "last-update stale";
        el.title = "Unable to fetch data";
        return;
    }

    const age = Date.now() - lastFetchTime;
    const mins = Math.floor(age / 60000);
    const hours = Math.floor(age / 3600000);

    let text, className;

    if (mins < 2) {
        text = "Updated just now";
        className = "fresh";
    } else if (mins < 60) {
        text = `Updated ${mins}m ago`;
        className = mins < 30 ? "fresh" : "recent";
    } else if (hours < 6) {
        text = `Updated ${hours}h ago`;
        className = "old";
    } else {
        text = `Updated ${hours}h+ ago`;
        className = "stale";
    }

    el.textContent = text;
    el.className = `last-update ${className}`;
    el.title = `Last updated: ${new Date(lastFetchTime).toLocaleString()}`;
}

// ==================== FORMATTING UTILITIES ====================

/**
 * Formats a duration in hours as a compact human-readable string (minutes, hours, or days).
 * @param {number} h - The duration in hours.
 * @returns {string} The formatted duration (e.g. "45m", "12h", "2.5d").
 */
export function fmt(h) {
    if (h < 1) return Math.round(h*60) + "m";
    if (h < 48) return Math.round(h) + "h";
    return (h/24).toFixed(1) + "d";
}

/**
 * Formats an arrival time, given hours from now, as a relative date-and-time string ("Today", "Tomorrow", or weekday plus a 12-hour clock time).
 * @param {number} hrs - Hours from the current time until arrival.
 * @returns {string} The formatted arrival string, or an empty string if hrs is falsy or non-positive.
 */
export function fmtArrival(hrs) {
    if (!hrs || hrs <= 0) return "";
    const arrival = new Date(Date.now() + hrs * 3600000);
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const timeStr = arrival.toLocaleTimeString("en-US", { hour: "numeric", hour12: true }).toLowerCase();

    if (arrival.toDateString() === now.toDateString()) {
        return `Today ${timeStr}`;
    } else if (arrival.toDateString() === tomorrow.toDateString()) {
        return `Tomorrow ${timeStr}`;
    } else {
        const dayStr = arrival.toLocaleDateString("en-US", { weekday: "short" });
        return `${dayStr} ${timeStr}`;
    }
}

// ==================== TREND DISPLAY ====================

/**
 * Derives the display icon, color, and optional magnitude string for an NWS trend object.
 * @param {Object} trend - The trend object; must have `source === "NWS"` to produce output, with `direction` ("up"/"down"/other) and optional `rate`.
 * @param {boolean} [showMagnitude=false] - Whether to include a percentage magnitude derived from `trend.rate`.
 * @returns {{icon: string, color: string, magnitude: string}|null} The display data, or null if the trend is missing or not NWS-sourced.
 */
export function getTrendData(trend, showMagnitude = false) {
    if (!trend || trend.source !== "NWS") return null;

    let icon, color;
    switch(trend.direction) {
        case "up":
            icon = "↑";
            color = "var(--color-trend-up)";
            break;
        case "down":
            icon = "↓";
            color = "var(--color-trend-down)";
            break;
        default:
            icon = "→";
            color = "var(--text-dim)";
    }

    let magnitude = "";
    if (showMagnitude && trend.rate !== undefined && trend.rate !== 0) {
        const pct = Math.round(trend.rate * 100);
        const sign = pct > 0 ? "+" : "";
        magnitude = " " + sign + pct + "%";
    }

    return { icon, color, magnitude };
}

/**
 * Renders an NWS trend's icon, magnitude, and color onto a DOM element, clearing it if the trend is not displayable.
 * @param {HTMLElement} el - The target element to update.
 * @param {Object} trend - The trend object passed through to getTrendData.
 * @param {boolean} [showMagnitude=false] - Whether to include the percentage magnitude.
 */
export function applyTrendToElement(el, trend, showMagnitude = false) {
    if (!el) return;
    const tData = getTrendData(trend, showMagnitude);
    if (!tData) {
        el.textContent = "";
        el.style.color = "";
        return;
    }
    el.textContent = tData.icon + tData.magnitude;
    el.style.color = tData.color;
    el.style.fontWeight = "bold";
}

/**
 * Builds an HTML snippet summarizing an NWS forecast trend's 24h and 48h discharge values, or an "n/a" snippet if no NWS trend is available.
 * @param {Object} trend - The trend object; must have `source === "NWS"`, with optional `forecast24` and `forecast48` cfs values.
 * @param {number} current - The current value (unused in output; present for call-site signature compatibility).
 * @returns {string} An HTML string for the forecast tooltip/cell.
 */
export function getTrendText(trend, current) {
    if (!trend || trend.source !== "NWS") {
        return `<span style="color:var(--text-tertiary);">n/a</span>`;
    }

    let html = `<b style="color:var(--accent-blue);">NWS Forecast</b><br>`;
    if (trend.forecast24) {
        html += `24h: ${Math.round(trend.forecast24).toLocaleString()} cfs<br>`;
    } else {
        html += `24h: n/a<br>`;
    }
    if (trend.forecast48) {
        html += `48h: ${Math.round(trend.forecast48).toLocaleString()} cfs`;
    } else {
        html += `48h: n/a`;
    }
    return html;
}

// Potomac Pulse — Data fetching, processing, caching, and utility functions
// Extracted from index.html inline script

import {
    LF, CACHE_KEY, CACHE_MAX_AGE, GAUGES, EDWARDS_FERRY,
    EF_MODEL, EF_HISTORY_MAX, MEDIAN_FLOW, SYNC_API,
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

import { getCorrectionFactor } from '../learning/gauge-learning.js';
import { recordObservation } from '../learning/gauge-learning.js';
import { fetchNWSForecasts } from '../estimation/nws.js';
import { fetchEdwardsFerry, fetchWaterTemp } from '../estimation/edwards-ferry.js';
import { updateUI } from '../ui/gauges-ui.js';
import { updateLearningUI } from '../ui/learning-ui.js';
import { updateCreeksUI } from '../ui/creeks-ui.js';

// ==================== CORE FUNCTIONS ====================

// Validate USGS API response schema
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

export function calcTravelTimes() {
    // Use Little Falls FLOW for multiplier (Searcy power law)
    const lfFlow = data[LF.id]?.q || MEDIAN_FLOW;
    const multInfo = getFlowMultiplier(lfFlow);
    data._mult = multInfo;

    for (const [id, g] of Object.entries(GAUGES)) {
        if (id === LF.id) continue;

        const d = data[id];
        if (!d) continue;

        // Base calculation using flow-based multiplier
        let travelHrs = g.baseHrs * multInfo.mult;

        // Apply learning correction
        const correction = getCorrectionFactor(id);
        travelHrs *= correction;

        d.travelHrs = travelHrs;
        d.baseHrs = g.baseHrs;
        d.mult = multInfo.mult;
        d.correction = correction;
        d.arrival = new Date(Date.now() + travelHrs * 3600000);
        d.pctLF = g.pctLF;
    }

    // Record observation for learning
    recordObservation();
}

// ==================== DATA PROCESSING ====================

// Process USGS JSON into the `data` object (no UI update)
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

export function fillMissingData() {
    // Get Little Falls and Point of Rocks as reference
    const lfQ = data[LF.id]?.q;
    const ptRocksQ = data["01638500"]?.q;
    const ptRocksH = data["01638500"]?.h;

    for (const [id, g] of Object.entries(GAUGES)) {
        if (id === LF.id) continue;
        if (!data[id]) data[id] = {};

        // Estimate missing discharge from drainage area ratio
        if (!data[id].q && lfQ) {
            data[id].q = Math.round(lfQ * (g.area / 11560));
            data[id].estimated = true;
        }

        // Estimate missing stage from Point of Rocks (rough approximation)
        if (!data[id].h && ptRocksH) {
            data[id].h = ptRocksH;
            data[id].estimated = true;
        }
    }
}

// ==================== FETCH CREEK DATA ====================

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

export async function fetchData() {
    if (isFetching) return;
    setIsFetching(true);
    try {
    setStatus("loading");
    const sites = Object.keys(GAUGES).join(",");
    const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${sites}&parameterCd=00060,00065&period=P7D&format=json`;

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
        updateUI();
        return;
    }

    processData(usgsJson);

    let nwsFinished = false;
    const nwsFetch = fetchNWSForecasts().then(() => { nwsFinished = true; });

    try {
        await Promise.race([
            nwsFetch,
            new Promise(resolve => setTimeout(resolve, 4000))
        ]);
    } catch(e) {
        console.warn('NWS forecast fetch error:', e);
    }

    setStatus(dataSource === "live" ? "ok" : (dataSource === "stale" ? "stale" : "cached"));
    updateUI();
    updateLearningUI();
    updateCreeksUI();

    // If NWS didn't finish within the 4s race, re-render when it arrives
    if (!nwsFinished) {
        nwsFetch.then(() => {
            console.log('📡 NWS arrived late — re-rendering forecast');
            updateUI();
        }).catch(() => {});
    }

    } finally {
        setIsFetching(false);
    }
}

// ==================== STATUS & UI UTILITIES ====================

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

export function showErrorBanner(msg) {
    const b = document.getElementById('error-banner');
    if (msg) document.getElementById('error-banner-text').textContent = msg;
    b.style.display = 'flex';
    if (errorBannerTimeout) clearTimeout(errorBannerTimeout);
    setErrorBannerTimeout(setTimeout(dismissErrorBanner, 10000));
}

export function dismissErrorBanner() {
    document.getElementById('error-banner').style.display = 'none';
    if (errorBannerTimeout) { clearTimeout(errorBannerTimeout); setErrorBannerTimeout(null); }
}

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

export function fmt(h) {
    if (h < 1) return Math.round(h*60) + "m";
    if (h < 48) return Math.round(h) + "h";
    return (h/24).toFixed(1) + "d";
}

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

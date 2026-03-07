// Potomac Pulse — NWS forecast integration
// Extracted from index.html inline script

import { NWS_LIDS } from '../model/constants.js';
import { data } from '../state/store.js';
import { fetchWithTimeout } from '../data/fetch.js';

// Fetch a single gauge's NWS forecast (tries multiple endpoints)
export async function fetchSingleNWSForecast(usgsId, nwsLid) {
    // Try forecast-only endpoint first (12 points, fast) before full stageflow (500+ points, slow)
    const endpoints = [
        `https://api.water.noaa.gov/nwps/v1/gauges/${nwsLid}/stageflow/forecast`,
        `https://api.water.noaa.gov/nwps/v1/gauges/${nwsLid.toLowerCase()}/stageflow/forecast`,
        `https://api.water.noaa.gov/nwps/v1/gauges/${nwsLid}/stageflow`,
        `https://api.water.noaa.gov/nwps/v1/gauges/${nwsLid.toLowerCase()}/stageflow`
    ];

    for (const url of endpoints) {
        try {
            const response = await fetchWithTimeout(url, 5000);
            if (response.ok) {
                const text = await response.text();
                try {
                    const json = JSON.parse(text);
                    const forecast = parseNWSForecast(json, usgsId, nwsLid);
                    if (forecast) {
                        console.log(`✓ NWS forecast for ${usgsId}`);
                        return { usgsId, forecast };
                    }
                } catch(parseErr) { /* skip */ }
            }
        } catch(fetchErr) { /* skip to next endpoint */ }
    }
    return null;  // No forecast found for this gauge
}

export async function fetchNWSForecasts() {
    console.log("=== Fetching NWS forecasts (parallel) ===");

    // Fetch ALL gauges in parallel (not sequential)
    const promises = Object.entries(NWS_LIDS).map(
        ([usgsId, nwsLid]) => fetchSingleNWSForecast(usgsId, nwsLid).catch(() => null)
    );
    const results = await Promise.all(promises);

    // Apply forecasts to data
    let count = 0;
    for (const result of results) {
        if (!result) continue;
        const { usgsId, forecast } = result;
        if (!data[usgsId]) continue;
        count++;
        data[usgsId].forecast = forecast;
        if (forecast.forecast24 || forecast.forecast48) {
            const currentFlow = data[usgsId].q;
            const futureFlow = forecast.forecast48 || forecast.forecast24;
            let direction = "stable";
            let rate = 0;
            if (currentFlow && futureFlow && currentFlow > 0) {
                rate = (futureFlow - currentFlow) / currentFlow;
                if (rate > 0.02) direction = "up";
                else if (rate < -0.02) direction = "down";
            }
            data[usgsId].trend = {
                direction, rate, source: "NWS",
                forecast24: forecast.forecast24,
                forecast48: forecast.forecast48
            };
        }
    }
    console.log(`=== NWS forecasts: ${count}/${Object.keys(NWS_LIDS).length} gauges ===`);
}

export function parseNWSForecast(json, usgsId, nwsLid) {
    try {
        console.log(`=== Parsing NWS for ${nwsLid} (${usgsId}) ===`);

        // Check for units - API returns kcfs (thousands of cfs)
        let flowMultiplier = 1;
        const secondaryUnits = json?.secondaryUnits || json?.forecast?.secondaryUnits;
        if (secondaryUnits === 'kcfs') {
            flowMultiplier = 1000;  // Convert kcfs to cfs
            console.log(`Flow units: kcfs, multiplier: 1000`);
        }

        // Find forecast data array
        let forecastData = null;
        const paths = [
            json?.forecast?.data,
            json?.data,  // Direct data array for /forecast endpoint
            json?.forecast,
            json?.data?.forecast?.data,
            json?.data?.forecast,
            json?.stageflow?.forecast?.data,
            json?.stageflow?.forecast
        ];

        for (const p of paths) {
            if (Array.isArray(p) && p.length > 0) {
                forecastData = p;
                break;
            }
        }

        if (!forecastData || forecastData.length === 0) {
            console.log(`No forecast array found for ${nwsLid}`);
            return null;
        }

        console.log(`Found ${forecastData.length} forecast points, flowMultiplier=${flowMultiplier}`);

        const now = Date.now();
        let forecast24 = null, forecast48 = null;
        let time24 = null, time48 = null;

        for (const point of forecastData) {
            // Parse time
            let timeStr = point.validTime || point.time || point.dateTime || point.valid || point.timestamp;
            if (!timeStr) continue;

            const validTime = new Date(timeStr).getTime();
            if (isNaN(validTime)) continue;

            const hoursAhead = (validTime - now) / 3600000;
            if (hoursAhead < 0 || hoursAhead > 72) continue;

            // Get secondary (flow) value and convert to cfs
            const rawFlow = parseFloat(point.secondary);
            if (isNaN(rawFlow) || rawFlow <= 0) continue;

            const cfs = rawFlow * flowMultiplier;

            // Find 24h and 48h forecasts
            if (hoursAhead >= 18 && hoursAhead <= 30 && !forecast24) {
                forecast24 = cfs;
                time24 = validTime;
                console.log(`24h forecast: ${rawFlow} kcfs = ${cfs} cfs at ${hoursAhead.toFixed(1)}h`);
            }
            if (hoursAhead >= 42 && hoursAhead <= 54 && !forecast48) {
                forecast48 = cfs;
                time48 = validTime;
                console.log(`48h forecast: ${rawFlow} kcfs = ${cfs} cfs at ${hoursAhead.toFixed(1)}h`);
            }

            if (forecast24 && forecast48) break;
        }

        // Widen search if needed
        if (!forecast24 || !forecast48) {
            for (const point of forecastData) {
                let timeStr = point.validTime || point.time || point.dateTime || point.valid || point.timestamp;
                if (!timeStr) continue;

                const validTime = new Date(timeStr).getTime();
                if (isNaN(validTime)) continue;

                const hoursAhead = (validTime - now) / 3600000;
                if (hoursAhead < 0 || hoursAhead > 96) continue;

                const rawFlow = parseFloat(point.secondary);
                if (isNaN(rawFlow) || rawFlow <= 0) continue;

                const cfs = rawFlow * flowMultiplier;

                if (!forecast24 && hoursAhead >= 12 && hoursAhead <= 36) {
                    forecast24 = cfs;
                    time24 = validTime;
                }
                if (!forecast48 && hoursAhead >= 36 && hoursAhead <= 72) {
                    forecast48 = cfs;
                    time48 = validTime;
                }

                if (forecast24 && forecast48) break;
            }
        }

        // If no cfs data available, return null
        if (!forecast24 && !forecast48) {
            console.log(`No valid cfs forecast data for ${nwsLid}`);
            return null;
        }

        console.log(`SUCCESS: ${nwsLid} -> 24h=${forecast24} cfs, 48h=${forecast48} cfs`);

        return {
            forecast24,
            forecast48,
            time24,
            time48,
            source: "NWS",
            // Include raw data array for detailed forecasting (48h graph)
            data: forecastData
        };
    } catch(e) {
        console.log("Error parsing NWS for", nwsLid, ":", e.message);
        return null;
    }
}

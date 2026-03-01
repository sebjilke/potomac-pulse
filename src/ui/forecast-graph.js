// Potomac Pulse — Forecast graph (SVG)
// Renders the 48h forecast graph with history and hover interactions
// Extracted from index.html inline script

import { estimateLFStage } from '../model/shared-model.js';
import {
    forecastGraphData, setForecastGraphData,
    graphScales, setGraphScales
} from '../state/store.js';

// Local copy of formatForecastTime to avoid circular dependency with great-falls-ui.js
function formatForecastTime(date) {
    const hours = date.getHours();
    const ampm = hours >= 12 ? 'pm' : 'am';
    const hour12 = hours % 12 || 12;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${days[date.getDay()]} ${hour12}${ampm}`;
}

// Accessor functions for external modules (great-falls-ui.js showGraphMarker)
export function getForecastGraphData() { return forecastGraphData; }
export function getGraphScales() { return graphScales; }

export function renderForecastGraph(periods, currentCFS, hasNWSForecast, historyPoints = []) {
    const svg = document.getElementById('gf-forecast-graph');
    if (!svg) return;

    const container = svg.parentElement;
    const width = container.clientWidth - 20; // Account for padding
    const height = 120;
    const padding = { top: 15, right: 10, bottom: 25, left: 35 };
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;

    // Always show 24h history layout; data fills in over time
    const hasHistory = true;
    const xMin = -24;
    const xMax = 48;
    const xRange = xMax - xMin; // 60 if history, 48 if not

    // Generate smooth curve from periods data (interpolate to 2-hour intervals)
    const now = new Date();
    const newForecastGraphData = [];

    // Prepend history points (already computed from porHistory)
    if (hasHistory) {
        for (const hp of historyPoints) {
            newForecastGraphData.push({
                hrs: hp.hrs,
                time: hp.time,
                cfs: hp.cfs,
                stage: hp.stage,
                isHistory: true
            });
        }
    }

    // Build interpolation points from forecast periods (0, 6, 12, 24, 48 hours)
    const periodPoints = periods.map(p => ({
        hrs: p.isCurrent ? 0 : parseInt(p.label.replace('+', '').replace('h', '')),
        cfs: p.cfs,
        stage: p.stage
    }));

    // Generate smooth forecast curve every 2 hours
    for (let hrs = 0; hrs <= 48; hrs += 2) {
        const time = new Date(now.getTime() + hrs * 60 * 60 * 1000);

        const before = periodPoints.filter(p => p.hrs <= hrs).pop();
        const after = periodPoints.find(p => p.hrs >= hrs);

        let cfs, stage;
        if (before && after && before !== after) {
            const t = (hrs - before.hrs) / (after.hrs - before.hrs);
            cfs = before.cfs + t * (after.cfs - before.cfs);
            stage = before.stage + t * (after.stage - before.stage);
        } else if (before) {
            cfs = before.cfs;
            stage = before.stage;
        } else if (after) {
            cfs = after.cfs;
            stage = after.stage;
        } else {
            cfs = currentCFS;
            stage = estimateLFStage(cfs);
        }

        newForecastGraphData.push({ hrs, time, cfs: Math.round(cfs), stage, isHistory: false });
    }

    // Update the store
    setForecastGraphData(newForecastGraphData);

    // Find min/max for scaling (include both history and forecast)
    const stages = newForecastGraphData.map(d => d.stage);
    const minStage = Math.floor(Math.min(...stages) * 2) / 2 - 0.5;
    const maxStage = Math.ceil(Math.max(...stages) * 2) / 2 + 0.5;
    const stageRange = maxStage - minStage || 1;
    const bottom = padding.top + graphHeight;

    // Scale functions — domain [xMin, xMax] → [padding.left, padding.left + graphWidth]
    const xScale = (hrs) => Math.round(padding.left + ((hrs - xMin) / xRange) * graphWidth);
    const yScale = (stage) => Math.round(padding.top + (1 - (stage - minStage) / stageRange) * graphHeight);

    // Store scales for external marker positioning
    setGraphScales({ xScale, yScale, padding, graphHeight });

    // Separate history and forecast data points
    const histData = newForecastGraphData.filter(d => d.isHistory);
    const fcstData = newForecastGraphData.filter(d => !d.isHistory);

    // Build forecast line path
    const fcstPathPoints = fcstData.map(d => `${xScale(d.hrs)},${yScale(d.stage)}`);
    const fcstLinePath = fcstPathPoints.length > 0 ? `M ${fcstPathPoints.join(' L ')}` : '';

    // Build forecast area fill (from NOW to +48h)
    let fcstAreaPath = '';
    if (fcstData.length > 0) {
        fcstAreaPath = `M ${xScale(0)},${yScale(fcstData[0].stage)} L ${fcstPathPoints.join(' L ')} L ${xScale(48)},${bottom} L ${xScale(0)},${bottom} Z`;
    }

    // Build history line path (ends at last history point — no bridge to forecast)
    let histLinePath = '';
    let histAreaPath = '';
    let histDotsSVG = '';
    if (hasHistory) {
        // History line: ends at last history data point (no bridge to forecast NOW point)
        // The two models differ (PoR-only vs full ensemble), so bridging creates a visible jump
        const histPathPoints = histData.map(d => `${xScale(d.hrs)},${yScale(d.stage)}`);
        histLinePath = `M ${histPathPoints.join(' L ')}`;

        // History area fill (dimmer) — from first to last history point
        const firstHistHrs = histData[0].hrs;
        const lastHistHrs = histData[histData.length - 1].hrs;
        histAreaPath = `M ${xScale(firstHistHrs)},${yScale(histData[0].stage)} L ${histPathPoints.join(' L ')} L ${xScale(lastHistHrs)},${bottom} L ${xScale(firstHistHrs)},${bottom} Z`;

        // History dots (small dots at each data point, ~15 min intervals)
        histDotsSVG = histData.map(d =>
            `<circle cx="${xScale(d.hrs)}" cy="${yScale(d.stage)}" r="2" fill="#60a5fa" opacity="0.7"/>`
        ).join('');
    }

    // Y-axis labels
    const yTicks = [];
    const tickStep = stageRange > 3 ? 1 : 0.5;
    for (let s = Math.ceil(minStage / tickStep) * tickStep; s <= maxStage; s += tickStep) {
        yTicks.push(s);
    }

    // X-axis labels — responsive: on narrow screens, drop history labels
    const isNarrow = graphWidth < 280;
    let xLabels;
    if (hasHistory) {
        xLabels = isNarrow
            ? [{ hrs: -12, label: '-12h' }, { hrs: 0, label: 'Now' }, { hrs: 12, label: '+12h' }, { hrs: 24, label: '+24h' }, { hrs: 48, label: '+48h' }]
            : [{ hrs: -24, label: '-24h' }, { hrs: -12, label: '-12h' }, { hrs: 0, label: 'Now' }, { hrs: 12, label: '+12h' }, { hrs: 24, label: '+24h' }, { hrs: 36, label: '+36h' }, { hrs: 48, label: '+48h' }];
    } else {
        xLabels = [{ hrs: 0, label: 'Now' }, { hrs: 12, label: '+12h' }, { hrs: 24, label: '+24h' }, { hrs: 36, label: '+36h' }, { hrs: 48, label: '+48h' }];
    }

    // X-axis grid lines — only at labeled positions
    const xGridLines = xLabels.map(l => l.hrs);

    // NOW divider line (vertical line at hrs=0, separating history from forecast)
    let nowDividerSVG = '';
    if (hasHistory) {
        const nowX = xScale(0);
        nowDividerSVG = `
            <line x1="${nowX}" y1="${padding.top}" x2="${nowX}" y2="${bottom}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3,2" opacity="0.6"/>
        `;
    }

    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.innerHTML = `
        <!-- Gradient definitions -->
        <defs>
            <linearGradient id="graphGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#4ade80" stop-opacity="0.4"/>
                <stop offset="100%" stop-color="#4ade80" stop-opacity="0"/>
            </linearGradient>
            <linearGradient id="histGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.25"/>
                <stop offset="100%" stop-color="#60a5fa" stop-opacity="0"/>
            </linearGradient>
        </defs>

        <!-- Grid lines -->
        ${yTicks.map(s => `<line x1="${padding.left}" y1="${yScale(s)}" x2="${width - padding.right}" y2="${yScale(s)}" stroke="#334155" stroke-width="1" stroke-dasharray="2,2"/>`).join('')}
        ${xGridLines.map(h => `<line x1="${xScale(h)}" y1="${padding.top}" x2="${xScale(h)}" y2="${bottom}" stroke="#334155" stroke-width="1" stroke-dasharray="2,2"/>`).join('')}

        <!-- History area fill (dimmer blue) -->
        ${histAreaPath ? `<path d="${histAreaPath}" fill="url(#histGradient)" opacity="0.3"/>` : ''}

        <!-- Forecast area fill (green) -->
        ${fcstAreaPath ? `<path d="${fcstAreaPath}" fill="url(#graphGradient)" opacity="0.3"/>` : ''}

        <!-- History line (solid blue) -->
        ${histLinePath ? `<path d="${histLinePath}" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linejoin="round"/>` : ''}

        <!-- History data dots -->
        ${histDotsSVG}

        <!-- Forecast line (green) -->
        ${fcstLinePath ? `<path d="${fcstLinePath}" fill="none" stroke="#4ade80" stroke-width="2" stroke-linejoin="round"/>` : ''}

        <!-- NOW divider line -->
        ${nowDividerSVG}

        <!-- Current point marker (at junction of history and forecast) -->
        ${fcstData.length > 0 ? `<circle cx="${xScale(0)}" cy="${yScale(fcstData[0].stage)}" r="4" fill="#4ade80" stroke="#0f172a" stroke-width="2"/>` : ''}

        <!-- Y-axis labels -->
        ${yTicks.map(s => `<text x="${padding.left - 5}" y="${yScale(s) + 3}" fill="#94a3b8" font-size="9" text-anchor="end">${s.toFixed(2)}</text>`).join('')}

        <!-- X-axis labels -->
        ${xLabels.map(l => `<text x="${xScale(l.hrs)}" y="${height - 5}" fill="${l.hrs === 0 ? '#f59e0b' : '#94a3b8'}" font-size="9" text-anchor="middle" font-weight="${l.hrs === 0 ? '600' : 'normal'}">${l.label}</text>`).join('')}

        <!-- Y-axis title -->
        <text x="10" y="${padding.top + graphHeight / 2}" fill="#4ade80" font-size="9" text-anchor="middle" transform="rotate(-90, 10, ${padding.top + graphHeight / 2})">ft</text>

        <!-- Invisible hover area -->
        <rect id="gf-graph-hover" x="${padding.left}" y="${padding.top}" width="${graphWidth}" height="${graphHeight}" fill="transparent"/>

        <!-- Selected period marker (hidden by default) -->
        <g id="gf-graph-marker" style="display:none;">
            <line id="gf-marker-line" x1="0" y1="${padding.top}" x2="0" y2="${bottom}" stroke="#60a5fa" stroke-width="2" stroke-dasharray="4,2"/>
            <circle id="gf-marker-dot" cx="0" cy="0" r="6" fill="#60a5fa" stroke="#0f172a" stroke-width="2"/>
        </g>
    `;

    // Add hover/touch interactions
    const hoverRect = document.getElementById('gf-graph-hover');
    const tooltip = document.getElementById('gf-graph-tooltip');

    function showTooltip(e) {
        const rect = svg.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
        const hrs = Math.max(xMin, Math.min(xMax, ((x - padding.left) / graphWidth) * xRange + xMin));

        // Find closest data point
        const closest = newForecastGraphData.reduce((prev, curr) =>
            Math.abs(curr.hrs - hrs) < Math.abs(prev.hrs - hrs) ? curr : prev
        );

        // Show label with history indicator
        const timeLabel = closest.isHistory
            ? `${formatForecastTime(closest.time)} (observed)`
            : formatForecastTime(closest.time);
        document.getElementById('gf-tooltip-time').textContent = timeLabel;
        document.getElementById('gf-tooltip-stage').textContent = closest.stage.toFixed(2);
        document.getElementById('gf-tooltip-cfs').textContent = closest.cfs.toLocaleString();

        // Position tooltip
        const tooltipX = Math.min(width - 100, Math.max(10, xScale(closest.hrs) - 40));
        const tooltipY = Math.max(5, yScale(closest.stage) - 55);
        tooltip.style.left = tooltipX + 'px';
        tooltip.style.top = tooltipY + 'px';
        tooltip.style.display = 'block';
    }

    function hideTooltip() {
        tooltip.style.display = 'none';
    }

    // Use property assignment to avoid stacking listeners on re-render
    hoverRect.onmousemove = showTooltip;
    hoverRect.ontouchmove = showTooltip;
    hoverRect.onmouseleave = hideTooltip;
    hoverRect.ontouchend = hideTooltip;
}

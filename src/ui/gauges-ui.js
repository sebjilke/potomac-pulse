// Potomac Pulse — Gauges UI (branches, gauge rows, map popups)
// Extracted from index.html inline script

import L from 'leaflet';
import { LF, GAUGES, BRANCHES } from '../model/constants.js';
import {
    data, markers
} from '../state/store.js';

import { fmt, fmtArrival, applyTrendToElement, getTrendData, getTrendText } from '../data/fetch.js';
import { updateGreatFallsUI } from '../ui/great-falls-ui.js';
import { panTo } from '../ui/map.js';

const BRANCH_STATE_KEY = 'potomac_branch_state';

/**
 * Persists each branch's open/closed state to localStorage, keyed by branch key.
 * Reads the `open` class on every `#b-<branchKey>` element and writes the map under BRANCH_STATE_KEY.
 * @returns {void}
 */
function saveBranchState() {
    const state = {};
    for (const bk of Object.keys(BRANCHES)) {
        const el = document.getElementById(`b-${bk}`);
        if (el) state[bk] = el.classList.contains('open');
    }
    try { localStorage.setItem(BRANCH_STATE_KEY, JSON.stringify(state)); } catch {}
}

/**
 * Reads the saved branch open/closed state from localStorage.
 * @returns {Object<string, boolean>|null} Map of branch key to open state, or null if absent/unparseable.
 */
function loadBranchState() {
    try {
        const raw = localStorage.getItem(BRANCH_STATE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

// ==================== BUILD BRANCHES ====================

/**
 * Builds and renders the gauge sidebar into #branches: a filter input, a column header, and one
 * collapsible branch block per BRANCHES entry, each containing a gauge row per gauge id. Restores
 * saved collapse state and wires up search/filter and click delegation (gauge row → panTo, branch
 * header → toggle open + saveBranchState).
 * @returns {void}
 */
export function buildBranches() {
    const savedState = loadBranchState();

    // Search input for filtering gauges
    let html = `<div class="gauge-search-wrap">
        <input type="text" id="gauge-search" class="gauge-search" placeholder="Filter gauges..." aria-label="Filter gauges by name or branch">
    </div>`;

    // Column header
    html += `<div class="gauge-header">
        <div></div>
        <div>Gauge</div>
        <div style="text-align:right;">24h Trend</div>
        <div style="text-align:right;">Basin</div>
        <div style="text-align:right;">CFS</div>
        <div style="text-align:right;">Hrs→LF</div>
    </div>`;
    for (const [bk, b] of Object.entries(BRANCHES)) {
        const isOpen = savedState ? !!savedState[bk] : bk === "mainstem";
        const open = isOpen ? "open" : "";
        const gaugeRows = b.ids.map(id => {
            const g = GAUGES[id];
            return `<div class="gauge" id="gauge-${id}" data-gauge-id="${id}" data-gauge-name="${g.name.toLowerCase()}">
                <div class="gauge-dot" style="background:${b.color}"></div>
                <div class="gauge-nm">${g.name}</div>
                <div class="gauge-trend" id="trend-${id}"></div>
                <div class="gauge-pct" id="pct-${id}">${g.pctLF}%</div>
                <div class="gauge-q" id="q-${id}">--</div>
                <div class="gauge-t" id="t-${id}">--</div>
            </div>`;
        }).join("");

        html += `<div class="branch ${open}" id="b-${bk}" data-branch-name="${b.name.toLowerCase()}">
            <div class="branch-hd" data-branch="${bk}">
                <div class="branch-clr" style="background:${b.color}"></div>
                <div class="branch-nm">${b.name}</div>
                <div class="branch-arr">▼</div>
            </div>
            <div class="branch-list">${gaugeRows}</div>
        </div>`;
    }
    const container = document.getElementById("branches");
    container.innerHTML = html;

    // Search/filter
    const searchInput = document.getElementById('gauge-search');
    searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        for (const [bk, b] of Object.entries(BRANCHES)) {
            const branchEl = document.getElementById(`b-${bk}`);
            if (!q) {
                // Reset: show all branches, restore saved collapse state
                branchEl.style.display = '';
                for (const id of b.ids) {
                    const row = document.getElementById(`gauge-${id}`);
                    if (row) row.style.display = '';
                }
                continue;
            }
            const branchNameMatch = b.name.toLowerCase().includes(q);
            let anyVisible = false;
            for (const id of b.ids) {
                const row = document.getElementById(`gauge-${id}`);
                const nameMatch = GAUGES[id].name.toLowerCase().includes(q);
                const show = nameMatch || branchNameMatch;
                if (row) row.style.display = show ? '' : 'none';
                if (show) anyVisible = true;
            }
            branchEl.style.display = anyVisible ? '' : 'none';
            if (anyVisible && q) branchEl.classList.add('open');
        }
    });

    // Event delegation for gauge rows and branch headers
    container.addEventListener('click', (e) => {
        // Gauge row click → panTo
        const gaugeRow = e.target.closest('.gauge[data-gauge-id]');
        if (gaugeRow) {
            panTo(gaugeRow.dataset.gaugeId);
            return;
        }
        // Branch header click → toggle open/close
        const branchHd = e.target.closest('.branch-hd[data-branch]');
        if (branchHd) {
            const branchEl = document.getElementById(`b-${branchHd.dataset.branch}`);
            if (branchEl) {
                branchEl.classList.toggle('open');
                saveBranchState();
            }
        }
    });
}

// ==================== UPDATE UI ====================

/**
 * Refreshes all gauge UI from the current `data` store: the Little Falls headline (CFS, stage, trend),
 * the travel-time multiplier readout, every gauge row's CFS / hrs-to-LF / trend cells (with ice-affected
 * and estimated styling and tooltips), each map marker's popup and flood-category border ring, and the
 * Great Falls estimate.
 * @returns {void}
 */
export function updateUI() {
    const lf = data[LF.id];
    document.getElementById("lfQ").textContent = lf?.q ? Math.round(lf.q).toLocaleString() : "--";
    document.getElementById("lfH").textContent = lf?.h ? lf.h.toFixed(2) : "--";
    applyTrendToElement(document.getElementById("lfTrend"), lf?.trend);

    const mult = data._mult;
    if (mult) {
        // Show actual travel time in hours (more intuitive than multiplier)
        const hrs = Math.round(mult.travelHrs);
        document.getElementById("multVal").textContent = `~${hrs} hrs`;
    }

    for (const b of Object.values(BRANCHES)) {
        for (const id of b.ids) {
            const d = data[id];
            const qe = document.getElementById(`q-${id}`);
            const te = document.getElementById(`t-${id}`);
            const tre = document.getElementById(`trend-${id}`);

            if (qe) {
                qe.textContent = d?.q ? Math.round(d.q).toLocaleString() : "n/a";
                // Ice-affected takes precedence over estimated
                const isIce = d?.iceAffected === true;
                const isEst = d?.estimated === true && !isIce;
                qe.classList.toggle('estimated', isEst);
                qe.classList.toggle('ice-affected', isIce);
                if (isIce) {
                    if (d.iceLongTerm) {
                        qe.title = 'Ice-affected >2 days: estimated from drainage ratio';
                    } else {
                        const daysAgo = d.lastValidTime ? ((Date.now() - d.lastValidTime) / (24*60*60*1000)).toFixed(1) : '?';
                        qe.title = `Ice-affected: last valid reading ${daysAgo} days ago`;
                    }
                } else if (isEst) {
                    qe.title = 'Estimated from drainage area ratio (gauge data unavailable)';
                } else {
                    qe.title = '';
                }
            }
            if (te) {
                if (d?.travelHrs) {
                    te.textContent = fmt(d.travelHrs);
                    te.title = `Arrives: ${fmtArrival(d.travelHrs)}`;
                } else {
                    te.textContent = "--";
                    te.title = "";
                }
            }
            if (tre) applyTrendToElement(tre, d?.trend, true); // Show magnitude in sidebar
        }
    }

    // Update markers — refresh popup and flood-condition border ring
    for (const [id, marker] of Object.entries(markers)) {
        const g = GAUGES[id];
        const d = data[id];
        if (!g || !d) continue;

        const bk = Object.entries(BRANCHES).find(([k,v]) => v.ids?.includes(id))?.[0];
        const color = bk === 'target' ? '#f97316' : BRANCHES[bk]?.color || '#60a5fa';
        marker.bindPopup(popup(id, g, color, bk));

        // Update border color from flood category
        const flood = d.floodCategory || 'no_flooding';
        const borderColor = flood === 'major'    ? '#991b1b' :
                            flood === 'moderate' ? '#ef4444' :
                            flood === 'minor'    ? '#f97316' :
                            flood === 'action'   ? '#fbbf24' : 'white';
        const size = Math.round(4 + Math.sqrt(g.pctLF) * 0.85);
        marker.setIcon(L.divIcon({
            className: '',
            html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid ${borderColor};box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>`,
            iconSize: [size, size],
            iconAnchor: [size/2, size/2]
        }));
    }

    // Update Great Falls estimate
    updateGreatFallsUI();
}

// ==================== POPUP ====================

/**
 * Builds the HTML string for a gauge's map popup: name, drainage area/%LF, CFS+stage, 24h trend,
 * and (for non-target gauges with travel data) travel time, %LF drainage, arrival time, calculation
 * note, below-Point-of-Rocks warning, and ice-affected/estimated status notices.
 * @param {string} id - USGS gauge id, used to look up `data[id]`.
 * @param {Object} g - Gauge config (name, area, pctLF, baseHrs).
 * @param {string} color - CSS color for the gauge name heading.
 * @param {string} bk - Branch key for this gauge (used to detect the "belowPtR" branch).
 * @returns {string} HTML markup for the Leaflet popup body.
 */
export function popup(id, g, color, bk) {
    const d = data[id] || {};
    const isTarget = id === LF.id;
    // Ice-affected takes precedence over estimated
    let statusLabel = '';
    if (d.iceAffected) {
        statusLabel = ' <span style="color:#7dd3fc;font-size:0.65rem;">❄️</span>';
    } else if (d.estimated) {
        statusLabel = ' <span style="color:#fbbf24;font-size:0.65rem;">(est*)</span>';
    }
    let html = `<div class="pop-nm" style="color:${color}">${g.name}</div>
        <div class="pop-area">${g.area?.toLocaleString()} sq mi${g.pctLF ? ' • ' + g.pctLF + '% of LF basin' : ''}</div>
        <div class="pop-row">
            <div class="pop-cell"><div class="pop-val blue">${d.q ? Math.round(d.q).toLocaleString() : "n/a"}${statusLabel}</div><div class="pop-lbl">cfs</div></div>
            <div class="pop-cell"><div class="pop-val green">${d.h ? d.h.toFixed(2) : "n/a"}</div><div class="pop-lbl">ft stage</div></div>
        </div>`;

    // Trend prediction
    const trendData = getTrendData(d.trend);
    const trendIconHtml = trendData ? `<span style="color:${trendData.color};font-weight:bold;">${trendData.icon}</span>` : '';
    html += `<div class="pop-trend">
        <div class="pop-trend-title">📈 24-Hour Trend ${trendIconHtml}</div>
        ${getTrendText(d.trend, d.q)}
    </div>`;

    if (!isTarget && d.travelHrs) {
        html += `<div class="pop-row">
            <div class="pop-cell"><div class="pop-val yellow">${fmt(d.travelHrs)}</div><div class="pop-lbl">travel time</div></div>
            <div class="pop-cell"><div class="pop-val purple">${g.pctLF}%</div><div class="pop-lbl">of LF drainage</div></div>
        </div>
        <div class="pop-arr"><b>Arrival:</b> ${d.arrival?.toLocaleString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</div>`;

        html += `<div class="pop-note">Calculation: ${g.baseHrs}h × ${d.mult?.toFixed(2) || "1.00"} mult</div>`;

        if (bk === "belowPtR") {
            html += `<div class="pop-warn">⚠️ Below Point of Rocks — can raise LF before upstream signal</div>`;
        }
    }
    if (d.iceAffected) {
        if (d.iceLongTerm) {
            html += `<div class="pop-warn" style="color:#7dd3fc;">❄️ Ice-affected >2 days: estimated from drainage ratio</div>`;
        } else {
            const daysAgo = d.lastValidTime ? ((Date.now() - d.lastValidTime) / (24*60*60*1000)).toFixed(1) : '?';
            html += `<div class="pop-warn" style="color:#7dd3fc;">❄️ Ice-affected: showing last valid reading from ${daysAgo} days ago</div>`;
        }
    } else if (d.estimated) {
        html += `<div class="pop-warn" style="color:#fbbf24;">* Estimated from drainage area ratio — gauge data unavailable (ice/malfunction)</div>`;
    }
    return html;
}

// Potomac Pulse — Gauges UI (branches and gauge rows)
// Extracted from index.html inline script

import { LF, GAUGES, BRANCHES } from '../model/constants.js';
import {
    data
} from '../state/store.js';

import { fmt, fmtArrival, applyTrendToElement } from '../data/fetch.js';
import { updateGreatFallsUI } from '../ui/great-falls-ui.js';

const BRANCH_STATE_KEY = 'potomac_branch_state';

const TREND_TIP = 'Forecast change in flow over the next 24 hours';
const BASIN_TIP = 'Share of the land draining to Little Falls that lies upstream of this gauge';

/**
 * Closes every open column-explanation bubble in the gauge header.
 * @returns {void}
 */
function closeColInfos() {
    document.querySelectorAll('.col-info.open').forEach(el => {
        el.classList.remove('open');
        el.setAttribute('aria-expanded', 'false');
    });
}

let colInfoDismissBound = false;

/**
 * Binds the document-level dismiss handlers (click or touch elsewhere, Escape) once for the page.
 * @returns {void}
 */
function bindColInfoDismiss() {
    if (colInfoDismissBound) return;
    colInfoDismissBound = true;
    const dismissOutside = (e) => {
        const t = e.target;
        if (!(t && typeof t.closest === 'function' && t.closest('.col-info-cell'))) closeColInfos();
    };
    document.addEventListener('click', dismissOutside);
    // iOS Safari sends no click to the document for a tap on a non-interactive element, so the touch is heard too.
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeColInfos();
    });
}

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
 * saved collapse state and wires up search/filter and click delegation (branch
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
        <div class="col-info-cell" style="text-align:right;">Next 24h <button type="button" class="col-info" aria-label="${TREND_TIP}" aria-expanded="false" data-tip="${TREND_TIP}">i</button></div>
        <div class="col-info-cell" style="text-align:right;">Basin <button type="button" class="col-info" aria-label="${BASIN_TIP}" aria-expanded="false" data-tip="${BASIN_TIP}">i</button></div>
        <div style="text-align:right;">CFS</div>
        <div style="text-align:right;">Hrs→LF</div>
    </div>`;
    for (const [bk, b] of Object.entries(BRANCHES)) {
        const isOpen = savedState ? !!savedState[bk] : bk === "mainstem";
        const open = isOpen ? "open" : "";
        const gaugeRows = b.ids.map(id => {
            const g = GAUGES[id];
            return `<div class="gauge" id="gauge-${id}" data-gauge-name="${g.name.toLowerCase()}">
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

    // Event delegation for the column info icons and branch headers
    bindColInfoDismiss();
    // Bound once: the fallback in init() can call buildBranches() a second time on the same container.
    if (container.dataset.wired) return;
    container.dataset.wired = '1';
    container.addEventListener('click', (e) => {
        // Click on a column header cell (label or icon) → toggle its bubble, close the other
        const cell = e.target.closest('.col-info-cell');
        const info = cell ? cell.querySelector('.col-info') : null;
        if (info) {
            const willOpen = !info.classList.contains('open');
            closeColInfos();
            if (willOpen) {
                info.classList.add('open');
                info.setAttribute('aria-expanded', 'true');
            }
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
 * and estimated styling and tooltips), and the Great Falls estimate.
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

    // Update Great Falls estimate
    updateGreatFallsUI();
}

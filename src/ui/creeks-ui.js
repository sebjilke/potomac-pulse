// Potomac Pulse — Creek runs UI
// Extracted from index.html inline script

import { CREEK_RUNS } from '../model/constants.js';
import { creekData } from '../state/store.js';

// ==================== BUILD CREEKS ====================

export function buildCreeks() {
    let html = '';
    for (const [id, c] of Object.entries(CREEK_RUNS)) {
        const awLink = c.awId ? `<a href="https://www.americanwhitewater.org/content/River/detail/id/${c.awId}" target="_blank" rel="noopener" aria-label="View ${c.name} on American Whitewater" style="color:#60a5fa;text-decoration:none;" title="American Whitewater">🔗 AW</a>` : '';
        const estMark = c.estimated ? ' <span title="Threshold is estimated" style="color:#f59e0b;cursor:help;">⚠</span>' : '';
        const microTag = c.microRun ? ' <span style="font-size:0.5rem;color:#94a3b8;background:rgba(148,163,184,0.15);padding:1px 4px;border-radius:3px;">micro-run</span>' : '';
        html += `<div class="creek-card" id="creek-${id}" style="${c.estimated ? 'border-style:dashed;' : ''}">
            <div class="creek-top">
                <div class="creek-dot" id="creek-dot-${id}"></div>
                <div class="creek-name">${c.name}${microTag}${estMark}</div>
                <div class="creek-cfs" id="creek-cfs-${id}">--</div>
                <div class="creek-trend" id="creek-trend-${id}"></div>
            </div>
            <div class="creek-meta">
                <span>Class ${c.class}</span>
                <span id="creek-lastran-${id}"></span>
                <span>USGS ${id}</span>
                ${awLink}
            </div>
            <div class="creek-status" id="creek-status-${id}"></div>
        </div>`;
    }
    document.getElementById("creeks-list").innerHTML = html;
}

// ==================== UPDATE CREEKS UI ====================

export function updateCreeksUI() {
    const entries = Object.entries(CREEK_RUNS);
    let runningCount = 0;
    const cardOrder = [];

    for (const [id, c] of entries) {
        const d = creekData[id];
        const dot = document.getElementById(`creek-dot-${id}`);
        const cfsEl = document.getElementById(`creek-cfs-${id}`);
        const trendEl = document.getElementById(`creek-trend-${id}`);
        const statusEl = document.getElementById(`creek-status-${id}`);
        const lastranEl = document.getElementById(`creek-lastran-${id}`);
        const card = document.getElementById(`creek-${id}`);

        if (!dot) continue;  // Card not built yet

        if (d) {
            const running = d.running;
            if (running) runningCount++;
            cardOrder.push({ id, running, q: d.q });

            // Dot color
            dot.style.background = running ? '#4ade80' : '#64748b';
            // CFS
            cfsEl.textContent = `${Math.round(d.q)} cfs`;
            cfsEl.style.color = running ? '#4ade80' : '#94a3b8';
            // Trend arrow
            const arrows = { rising: '↑', falling: '↓', steady: '→' };
            const colors = { rising: '#4ade80', falling: '#f87171', steady: '#94a3b8' };
            const titles = { rising: 'Flow rising', falling: 'Flow falling', steady: 'Flow steady' };
            trendEl.textContent = arrows[d.trend] || '→';
            trendEl.style.color = colors[d.trend] || '#94a3b8';
            trendEl.title = titles[d.trend] || 'Flow steady';
            // Status text
            if (running) {
                statusEl.textContent = `Running! (≥${c.runnable} cfs)`;
                statusEl.style.color = '#4ade80';
            } else {
                statusEl.textContent = `Needs ≥${c.runnable} cfs${c.microRun ? ' (micro-run)' : ''}`;
                statusEl.style.color = '#94a3b8';
            }
            // Card border glow for running creeks
            card.style.borderColor = running ? '#4ade80' : '#334155';
        } else {
            // No data
            dot.style.background = '#475569';
            cfsEl.textContent = '❓ No data';
            cfsEl.style.color = '#94a3b8';
            trendEl.textContent = '';
            statusEl.textContent = 'Gauge offline or no response';
            statusEl.style.color = '#94a3b8';
            card.style.borderColor = '#334155';
            cardOrder.push({ id, running: false, q: -1 });
        }

        // Last ran (try/catch for localStorage disabled in private browsing)
        try {
            const lastRanStr = localStorage.getItem(`creek_lastran_${id}`);
            if (lastRanStr) {
                const lastRan = new Date(lastRanStr);
                const now = new Date();
                const daysAgo = Math.round((now - lastRan) / 86400000);
                if (d?.running) {
                    lastranEl.textContent = 'Last ran: now';
                } else if (daysAgo === 0) {
                    lastranEl.textContent = 'Last ran: today';
                } else if (daysAgo === 1) {
                    lastranEl.textContent = 'Last ran: yesterday';
                } else {
                    lastranEl.textContent = `Last ran: ${daysAgo}d ago`;
                }
            } else {
                lastranEl.textContent = 'Last ran: unknown';
            }
        } catch(e) { lastranEl.textContent = ''; }
    }

    // Sort: running creeks first (by cfs descending), then non-running
    cardOrder.sort((a, b) => {
        if (a.running && !b.running) return -1;
        if (!a.running && b.running) return 1;
        return b.q - a.q;
    });
    const listEl = document.getElementById("creeks-list");
    for (const item of cardOrder) {
        const card = document.getElementById(`creek-${item.id}`);
        if (card) listEl.appendChild(card);
    }

    // Master status banner
    const statusEl = document.getElementById("creeks-status");
    const total = entries.length;
    if (runningCount > 0) {
        statusEl.innerHTML = `<div class="creeks-banner running">🟢 CREEKS ARE RUNNING — ${runningCount} of ${total} runnable</div>`;
    } else {
        // Find most recent "last ran" across all creeks
        let lastActivity = '';
        try {
            let latestStr = null;
            let latestId = null;
            for (const [id] of entries) {
                const lr = localStorage.getItem(`creek_lastran_${id}`);
                if (lr && (!latestStr || lr > latestStr)) {
                    latestStr = lr;
                    latestId = id;
                }
            }
            if (latestStr && latestId) {
                const daysAgo = Math.round((new Date() - new Date(latestStr)) / 86400000);
                const name = CREEK_RUNS[latestId].name;
                lastActivity = ` — Last activity: ${name}, ${daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : daysAgo + 'd ago'}`;
            }
        } catch(e) {}
        statusEl.innerHTML = `<div class="creeks-banner quiet">⚫ Nothing running${lastActivity}</div>`;
    }

    // Tab indicator dot
    const creeksTab = document.querySelector('.tab[data-tab="creeks"]');
    if (creeksTab) {
        creeksTab.classList.toggle('has-running', runningCount > 0);
    }
}

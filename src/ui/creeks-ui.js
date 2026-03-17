// Potomac Pulse — Creek runs UI
// Extracted from index.html inline script

import { CREEK_RUNS } from '../model/constants.js';
import { creekData } from '../state/store.js';

// ==================== BUILD CREEKS ====================

export function buildCreeks() {
    let html = '';
    for (const [id, c] of Object.entries(CREEK_RUNS)) {
        const awLink = c.awId ? `<a href="https://www.americanwhitewater.org/content/River/detail/id/${c.awId}" target="_blank" rel="noopener" aria-label="View ${c.name} on American Whitewater" style="color:var(--accent-blue);text-decoration:none;" title="American Whitewater">🔗 AW</a>` : '';
        const microTag = c.microRun ? ' <span style="font-size:0.5rem;color:var(--text-tertiary);background:rgba(148,163,184,0.15);padding:1px 4px;border-radius:3px;">micro-run</span>' : '';
        html += `<div class="creek-card" id="creek-${id}" role="button" tabindex="0" aria-expanded="false">
            <div class="creek-top">
                <div class="creek-dot" id="creek-dot-${id}"></div>
                <div class="creek-name">${c.name}${microTag}</div>
                <div class="creek-cfs" id="creek-cfs-${id}">--</div>
                <div class="creek-trend" id="creek-trend-${id}"></div>
                <div class="creek-chevron">›</div>
            </div>
            <div class="creek-meta">
                <span>Class ${c.class}</span>
                <span id="creek-lastran-${id}"></span>
                <span>USGS ${id}</span>
                ${awLink}
            </div>
            <div class="creek-status" id="creek-status-${id}"></div>
            <div class="creek-chart" id="creek-chart-${id}" aria-hidden="true"></div>
        </div>`;
    }
    document.getElementById("creeks-list").innerHTML = html;

    // Attach click/keyboard listeners
    for (const id of Object.keys(CREEK_RUNS)) {
        const card = document.getElementById(`creek-${id}`);
        if (card) {
            card.addEventListener('click', () => toggleCreekChart(id));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCreekChart(id); }
            });
        }
    }
}

// ==================== TOGGLE CHART ====================

function toggleCreekChart(id) {
    const chartEl = document.getElementById(`creek-chart-${id}`);
    const card = document.getElementById(`creek-${id}`);
    if (!chartEl || !card) return;
    const isExpanded = chartEl.classList.contains('expanded');

    // Collapse all first
    for (const k of Object.keys(CREEK_RUNS)) {
        const el = document.getElementById(`creek-chart-${k}`);
        const c = document.getElementById(`creek-${k}`);
        if (el) el.classList.remove('expanded');
        if (c) { c.classList.remove('expanded'); c.setAttribute('aria-expanded', 'false'); }
    }

    // Open this one if it was closed
    if (!isExpanded) {
        chartEl.classList.add('expanded');
        card.classList.add('expanded');
        card.setAttribute('aria-expanded', 'true');
        renderCreekChart(id, chartEl);
    }
}

// ==================== RENDER CREEK CHART ====================

function renderCreekChart(id, el) {
    const d = creekData[id];
    const c = CREEK_RUNS[id];
    if (!d || !c) {
        el.innerHTML = '<div style="padding:8px;font-size:0.6rem;color:var(--text-tertiary);text-align:center;">No data available</div>';
        return;
    }

    const history = d.history || [];
    if (history.length < 2) {
        el.innerHTML = '<div style="padding:8px;font-size:0.6rem;color:var(--text-tertiary);text-align:center;">Not enough history yet</div>';
        return;
    }

    const W = el.clientWidth || 300;
    const H = 80;
    const pad = { top: 12, right: 10, bottom: 22, left: 44 };
    const gW = W - pad.left - pad.right;
    const gH = H - pad.top - pad.bottom;

    const threshold = c.runnable;
    const allQ = history.map(p => p.q);
    const rawMin = Math.min(...allQ, threshold);
    const rawMax = Math.max(...allQ, threshold);
    const qRange = rawMax - rawMin || 1;
    const qMin = rawMin - qRange * 0.10;
    const qMax = rawMax + qRange * 0.10;

    const now = Date.now();
    const xMin = now - 24 * 3600 * 1000;
    const xRange = now - xMin;

    const xScale = (t) => pad.left + ((t - xMin) / xRange) * gW;
    const yScale = (q) => pad.top + (1 - (q - qMin) / (qMax - qMin)) * gH;

    // Build SVG path
    const pts = history.filter(p => p.time.getTime() >= xMin);
    if (pts.length < 2) {
        el.innerHTML = '<div style="padding:8px;font-size:0.6rem;color:var(--text-tertiary);text-align:center;">Not enough history yet</div>';
        return;
    }

    const lineColor = d.running ? 'var(--accent-green)' : 'var(--text-muted)';
    const fillId = `cgf-${id}`;

    // Line path
    let linePath = '';
    for (let i = 0; i < pts.length; i++) {
        const x = xScale(pts[i].time.getTime());
        const y = yScale(pts[i].q);
        linePath += i === 0 ? `M ${x},${y}` : ` L ${x},${y}`;
    }

    // Area fill path (close to bottom)
    const x0 = xScale(pts[0].time.getTime());
    const xN = xScale(pts[pts.length - 1].time.getTime());
    const yBottom = pad.top + gH;
    const areaPath = linePath + ` L ${xN},${yBottom} L ${x0},${yBottom} Z`;

    // Horizontal gridlines at round CFS values
    const visRange = qMax - qMin;
    const rawStep = Math.pow(10, Math.floor(Math.log10(visRange)));
    const step = visRange / rawStep >= 6 ? rawStep * 2 : visRange / rawStep >= 3 ? rawStep : rawStep / 2;
    const gridStart = Math.ceil(qMin / step) * step;
    const gridLines = [];
    for (let q = gridStart; q <= qMax; q += step) {
        const gy = yScale(q);
        if (gy < pad.top || gy > pad.top + gH) continue;
        // Skip if too close to threshold line (within 6px) — threshold already has its own line+label
        if (Math.abs(gy - yScale(threshold)) < 6) continue;
        gridLines.push(`<line x1="${pad.left}" y1="${gy}" x2="${pad.left + gW}" y2="${gy}" stroke="var(--border-default)" stroke-width="0.5" opacity="0.5"/>` +
            `<text x="${pad.left - 2}" y="${gy + 3}" font-size="6" fill="var(--text-muted)" text-anchor="end" opacity="0.7">${Math.round(q)}</text>`);
    }
    const gridHTML = gridLines.join('');

    // Threshold line
    const ty = yScale(threshold);
    const thresholdLine = (ty >= pad.top && ty <= pad.top + gH)
        ? `<line x1="${pad.left}" y1="${ty}" x2="${pad.left + gW}" y2="${ty}" stroke="var(--accent-loading)" stroke-width="1" stroke-dasharray="4,3" opacity="0.8"/>`
        : '';

    // Threshold label
    const thresholdLabel = (ty >= pad.top && ty <= pad.top + gH)
        ? `<text x="${pad.left - 2}" y="${ty + 3}" font-size="7" fill="var(--accent-loading)" text-anchor="end" opacity="0.9">${threshold}</text>`
        : '';

    // Current value dot
    const lastPt = pts[pts.length - 1];
    const dotX = xScale(lastPt.time.getTime());
    const dotY = yScale(lastPt.q);
    const dotColor = d.running ? 'var(--accent-green)' : 'var(--text-muted)';

    // Y-axis labels: min and current
    const yLabelCurrent = `<text x="${pad.left - 2}" y="${dotY + 3}" font-size="7" fill="${dotColor}" text-anchor="end" font-weight="600">${Math.round(d.q)}</text>`;

    // X-axis labels: 24h ago, 12h ago, Now
    const xLabels = [
        { t: xMin, label: '24h ago' },
        { t: xMin + xRange / 2, label: '12h ago' },
        { t: now, label: 'Now' }
    ].map(({ t, label }) => {
        const x = xScale(t);
        return `<text x="${x}" y="${H - 4}" font-size="7" fill="var(--text-muted)" text-anchor="${t === xMin ? 'start' : t === now ? 'end' : 'middle'}">${label}</text>`;
    }).join('');

    // Gradient def
    const gradColor = d.running ? '74,222,128' : '100,116,139';

    el.innerHTML = `<svg width="${W}" height="${H}" style="display:block;overflow:visible;">
  <defs>
    <linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(${gradColor},0.25)"/>
      <stop offset="100%" stop-color="rgba(${gradColor},0)"/>
    </linearGradient>
  </defs>
  ${gridHTML}
  <path d="${areaPath}" fill="url(#${fillId})"/>
  <path d="${linePath}" fill="none" stroke="${lineColor}" stroke-width="1.5" stroke-linejoin="round"/>
  ${thresholdLine}
  ${thresholdLabel}
  <circle cx="${dotX}" cy="${dotY}" r="3" fill="${dotColor}"/>
  ${yLabelCurrent}
  ${xLabels}
</svg>`;
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
            dot.style.background = running ? 'var(--accent-green)' : 'var(--text-muted)';
            // CFS
            cfsEl.textContent = `${Math.round(d.q)} cfs`;
            cfsEl.style.color = running ? 'var(--accent-green)' : 'var(--text-tertiary)';
            // Trend arrow
            const arrows = { rising: '↑', falling: '↓', steady: '→' };
            const colors = { rising: 'var(--accent-green)', falling: 'var(--accent-red-light)', steady: 'var(--text-tertiary)' };
            const titles = { rising: 'Flow rising', falling: 'Flow falling', steady: 'Flow steady' };
            trendEl.textContent = arrows[d.trend] || '→';
            trendEl.style.color = colors[d.trend] || 'var(--text-tertiary)';
            trendEl.title = titles[d.trend] || 'Flow steady';
            // Status text
            if (running) {
                statusEl.textContent = `Running! (≥${c.runnable} cfs)`;
                statusEl.style.color = 'var(--accent-green)';
            } else {
                statusEl.textContent = `Needs ≥${c.runnable} cfs${c.microRun ? ' (micro-run)' : ''}`;
                statusEl.style.color = 'var(--text-tertiary)';
            }
            // Card border glow for running creeks
            card.style.borderColor = running ? 'var(--accent-green)' : 'var(--border-default)';
        } else {
            // No data
            dot.style.background = 'var(--border-hover)';
            cfsEl.textContent = '❓ No data';
            cfsEl.style.color = 'var(--text-tertiary)';
            trendEl.textContent = '';
            statusEl.textContent = 'Gauge offline or no response';
            statusEl.style.color = 'var(--text-tertiary)';
            card.style.borderColor = 'var(--border-default)';
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

        // Re-render chart if this card is currently expanded
        const chartEl = document.getElementById(`creek-chart-${id}`);
        if (chartEl?.classList.contains('expanded')) {
            renderCreekChart(id, chartEl);
        }
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

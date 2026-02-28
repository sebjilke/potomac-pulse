// Potomac Pulse — Gauges UI (branches, gauge rows, map popups)
// Extracted from index.html inline script

import { LF, GAUGES, BRANCHES } from '../model/constants.js';
import {
    data, markers, learningData
} from '../state/store.js';

import { fmt, fmtArrival, applyTrendToElement, getTrendData, getTrendText } from '../data/fetch.js';
import { updateGreatFallsUI } from '../ui/great-falls-ui.js';
import { panTo } from '../ui/map.js';

// ==================== BUILD BRANCHES ====================

export function buildBranches() {
    // Column header to explain what each number means (matches .gauge grid layout)
    let html = `<div class="gauge-header">
        <div></div>
        <div>Gauge</div>
        <div style="text-align:right;">Trend</div>
        <div style="text-align:right;">Basin</div>
        <div style="text-align:right;">CFS</div>
        <div style="text-align:right;">Hrs→LF</div>
    </div>`;
    for (const [bk, b] of Object.entries(BRANCHES)) {
        const open = bk === "mainstem" ? "open" : "";
        const gaugeRows = b.ids.map(id => {
            const g = GAUGES[id];
            return `<div class="gauge" id="gauge-${id}" onclick="panTo('${id}')">
                <div class="gauge-dot" style="background:${b.color}"></div>
                <div class="gauge-nm">${g.name}</div>
                <div class="gauge-trend" id="trend-${id}"></div>
                <div class="gauge-pct" id="pct-${id}">${g.pctLF}%</div>
                <div class="gauge-q" id="q-${id}">--</div>
                <div class="gauge-t" id="t-${id}">--</div>
            </div>`;
        }).join("");

        html += `<div class="branch ${open}" id="b-${bk}">
            <div class="branch-hd" onclick="document.getElementById('b-${bk}').classList.toggle('open')">
                <div class="branch-clr" style="background:${b.color}"></div>
                <div class="branch-nm">${b.name}</div>
                <div class="branch-arr">▼</div>
            </div>
            <div class="branch-list">${gaugeRows}</div>
        </div>`;
    }
    document.getElementById("branches").innerHTML = html;

    // Expose panTo globally for onclick handlers
    window.panTo = panTo;
}

// ==================== UPDATE UI ====================

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

    // Update markers
    for (const [id, marker] of Object.entries(markers)) {
        const g = GAUGES[id];
        const d = data[id];
        if (!g || !d) continue;

        const bk = Object.entries(BRANCHES).find(([k,v]) => v.ids?.includes(id))?.[0];
        const color = BRANCHES[bk]?.color || "#60a5fa";
        marker.bindPopup(popup(id, g, color, bk));
    }

    // Update Great Falls estimate
    updateGreatFallsUI();
}

// ==================== POPUP ====================

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
        <div class="pop-trend-title">📈 48-Hour Trend ${trendIconHtml}</div>
        ${getTrendText(d.trend, d.q)}
    </div>`;

    if (!isTarget && d.travelHrs) {
        html += `<div class="pop-row">
            <div class="pop-cell"><div class="pop-val yellow">${fmt(d.travelHrs)}</div><div class="pop-lbl">travel time</div></div>
            <div class="pop-cell"><div class="pop-val purple">${g.pctLF}%</div><div class="pop-lbl">of LF drainage</div></div>
        </div>
        <div class="pop-arr"><b>Arrival:</b> ${d.arrival?.toLocaleString("en-US",{weekday:"short",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</div>`;

        html += `<div class="pop-note">Calculation: ${g.baseHrs}h × ${d.mult?.toFixed(2) || "1.00"} mult`;
        if (d.correction && d.correction !== 1.0) {
            html += ` × ${d.correction.toFixed(3)} learned`;
        }
        html += `</div>`;

        // Learning status
        const obs = learningData?.observations[id]?.length || 0;
        if (obs > 0) {
            html += `<div class="pop-learn">🧠 ${obs} observations recorded</div>`;
        }

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

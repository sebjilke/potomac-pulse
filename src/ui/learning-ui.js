// Potomac Pulse — Learning UI (admin dashboard, GF learning, shadow models, health)
// Extracted from index.html inline script

import { GAUGES, SHADOW_STATE_KEY } from '../model/constants.js';
import {
    data, learningData, learningEnabled, setLearningEnabled,
    gfLearningData, gfEstimate,
    edwardsFerryData, lastFetchTime,
    shadowModelState, shadowResults, setShadowModelState, setShadowResults,
    shadowLeaderboard
} from '../state/store.js';

// ==================== UPDATE GF LEARNING UI ====================

export function updateGFLearningUI() {
    if (!gfLearningData?.metadata) return;

    const meta = gfLearningData.metadata;
    const valLast = document.getElementById('gf-val-last');
    const learnValLast = document.getElementById('learn-val-last');
    const pendingCount = gfLearningData.pendingPredictions?.length || 0;

    // Build validation status text
    let statusText = '';
    if (pendingCount > 0) {
        statusText += pendingCount + ' pending | ';
    }
    if (meta.totalValidations > 0) {
        const avgErr = meta.avgErrorPercent ? meta.avgErrorPercent.toFixed(1) : '--';
        const lastVal = meta.lastValidation ? new Date(meta.lastValidation).toLocaleString() : '--';
        statusText += meta.totalValidations + ' validated | Avg err: ' + avgErr + '% | Last: ' + lastVal;
    } else {
        statusText += 'No validations yet - collecting data';
    }

    // Update both GF tab (hidden) and Learning tab elements
    if (valLast) valLast.textContent = statusText;
    if (learnValLast) learnValLast.textContent = statusText;

    // Historical accuracy badge removed (v33.2): The instantaneous GF accuracy metric
    // was structurally flawed — it compared predictions from 6-7h ago against LF readings
    // taken 2-4h late, on a changing river. This systematically overestimated error by 15-25pp.
    // The forecast accuracy system (+6h through +48h, 86-92%) provides clean validation.
    // The learning/correction system (EMA per flow bin) continues running regardless.
    // See analysis notes: no operational forecast agency publishes instantaneous accuracy
    // at ungauged points — the standard is forecast validation at gauged locations.

    // Update health stats in Learning tab
    updateHealthStats(meta, pendingCount);

    // Update bin statistics table (if Learning tab is unlocked)
    updateGFBinStats();
}

// ==================== HEALTH STATS ====================

export function updateHealthStats(meta, pendingCount) {
    const lastRunEl = document.getElementById('healthLastRun');
    const consecutiveEl = document.getElementById('healthConsecutive');
    const missedEl = document.getElementById('healthMissed');
    const pendingEl = document.getElementById('healthPending');
    const explainEl = document.getElementById('healthExplain');

    if (!lastRunEl) return;  // Elements not in DOM yet

    // Last run time
    if (meta.lastPrediction) {
        const lastRun = new Date(meta.lastPrediction);
        const hoursAgo = ((Date.now() - lastRun) / (60 * 60 * 1000)).toFixed(1);
        lastRunEl.textContent = `${hoursAgo}h ago`;
        lastRunEl.style.color = hoursAgo <= 3 ? 'var(--accent-green)' : hoursAgo <= 6 ? 'var(--accent-amber)' : 'var(--accent-red)';
    } else {
        lastRunEl.textContent = 'Never';
        lastRunEl.style.color = 'var(--accent-red)';
    }

    // Consecutive runs
    const consecutive = meta.consecutiveRuns || 0;
    consecutiveEl.textContent = consecutive;
    consecutiveEl.style.color = consecutive >= 10 ? 'var(--accent-green)' : consecutive >= 3 ? 'var(--accent-amber)' : 'var(--accent-red)';

    // Missed runs
    const missed = meta.missedRuns || 0;
    missedEl.textContent = missed;
    missedEl.style.color = missed === 0 ? 'var(--accent-green)' : missed <= 5 ? 'var(--accent-amber)' : 'var(--accent-red)';

    // Pending predictions
    pendingEl.textContent = pendingCount;
    pendingEl.style.color = pendingCount <= 1 ? 'var(--accent-green)' : pendingCount <= 3 ? 'var(--accent-amber)' : 'var(--accent-red)';

    // Explanation
    let explain = '';
    if (consecutive >= 10) {
        explain = '✅ Scheduled function running reliably (every 2h)';
    } else if (consecutive >= 3) {
        explain = '⚠️ Function running but had recent gaps';
    } else if (consecutive === 0) {
        explain = '❌ Function may not be running - check Netlify logs';
    } else {
        explain = 'ℹ️ Monitoring function execution...';
    }
    explainEl.textContent = explain;
}

// ==================== GF BIN STATS ====================

export function updateGFBinStats() {
    const container = document.getElementById('gfBinStats');
    if (!container) return;
    container.textContent = ''; // Clear

    if (!gfLearningData?.correctionBins) {
        const p = document.createElement('p');
        p.style.color = 'var(--text-muted)';
        p.textContent = 'No bin data available';
        container.appendChild(p);
        return;
    }

    const bins = gfLearningData.correctionBins;
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.fontSize = '0.5rem';

    // Header row
    const headerRow = document.createElement('tr');
    ['Flow Bin', 'Rising', 'Steady', 'Falling'].forEach(text => {
        const th = document.createElement('th');
        th.textContent = text;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    // Data rows
    const flowBins = ['0-3000', '3000-6000', '6000-12000', '12000-25000', '25000-50000', '50000+'];
    const colorFor = n => n >= 5 ? 'var(--accent-green)' : n > 0 ? 'var(--accent-amber)' : 'var(--text-muted)';

    for (const bin of flowBins) {
        const binData = bins[bin] || {};
        const rising = binData.rising?.count || 0;
        const steady = binData.steady?.count || 0;
        const falling = binData.falling?.count || 0;

        const row = document.createElement('tr');

        const binCell = document.createElement('td');
        binCell.textContent = bin;
        row.appendChild(binCell);

        [rising, steady, falling].forEach(val => {
            const td = document.createElement('td');
            td.textContent = val;
            td.style.color = colorFor(val);
            row.appendChild(td);
        });

        table.appendChild(row);
    }
    container.appendChild(table);

    // Add correction summary
    const meta = gfLearningData.metadata || {};
    if (meta.resetAt) {
        const p = document.createElement('p');
        p.style.marginTop = '8px';
        p.style.color = 'var(--accent-purple)';
        p.textContent = 'Reset: ' + new Date(meta.resetAt).toLocaleDateString() + ' (' + (meta.resetReason || 'manual') + ')';
        container.appendChild(p);
    }
}

// ==================== TOGGLE LEARNING ====================

export function toggleLearning() {
    setLearningEnabled(!learningEnabled);
    const btn = document.getElementById("learnBtn");
    if (btn) btn.classList.toggle("active", learningEnabled);
}

// ==================== ADMIN DASHBOARD ====================

export function updateAdminDashboard() {
    // Current gauge readings
    const lf = data["01646500"];
    const por = data["01638500"];
    const mono = data["01643000"];
    const goose = data["01644000"];
    const ef = edwardsFerryData.current;

    // LF Actual
    if (!document.getElementById("dash-lf-cfs")) return; // Dashboard not rendered
    document.getElementById("dash-lf-cfs").textContent = lf?.q ? Math.round(lf.q).toLocaleString() : "--";
    document.getElementById("dash-lf-stage").textContent = lf?.h ? `${lf.h.toFixed(2)} ft` : "-- ft";

    // GF Estimate
    if (gfEstimate) {
        document.getElementById("dash-gf-cfs").textContent = gfEstimate.cfs.toLocaleString();
        document.getElementById("dash-gf-stage").textContent = `${gfEstimate.stage.toFixed(2)} ft`;
    } else {
        document.getElementById("dash-gf-cfs").textContent = "--";
        document.getElementById("dash-gf-cfs").style.color = por?.iceAffected ? "var(--accent-blue)" : "var(--accent-green)";
        document.getElementById("dash-gf-stage").textContent = por?.iceAffected ? "❄️ ice" : "-- ft";
    }

    // PoR
    document.getElementById("dash-por-cfs").textContent = por?.q ? Math.round(por.q).toLocaleString() : "--";
    if (por?.iceAffected) {
        document.getElementById("dash-por-cfs").style.color = "var(--accent-blue)";
        const daysAgo = por.lastValidTime ? ((Date.now() - por.lastValidTime) / (24*60*60*1000)).toFixed(1) : "?";
        document.getElementById("dash-por-status").textContent = `❄️ ${daysAgo}d old`;
        document.getElementById("dash-por-status").style.color = "var(--accent-blue)";
    } else {
        document.getElementById("dash-por-cfs").style.color = "var(--accent-blue)";
        document.getElementById("dash-por-status").textContent = por?.trend || "--";
        document.getElementById("dash-por-status").style.color = "var(--text-tertiary)";
    }

    // Edwards Ferry
    document.getElementById("dash-ef-stage").textContent = ef?.stage ? `${ef.stage.toFixed(2)} ft` : "--";

    // Tributaries
    document.getElementById("dash-mono-cfs").textContent = mono?.q ? Math.round(mono.q).toLocaleString() : "--";
    if (mono?.iceAffected) document.getElementById("dash-mono-cfs").style.color = "var(--accent-blue)";
    document.getElementById("dash-goose-cfs").textContent = goose?.q ? Math.round(goose.q).toLocaleString() : "--";

    // Travel time
    const mult = data._mult;
    document.getElementById("dash-travel").textContent = mult?.travelHrs ? `~${Math.round(mult.travelHrs)}h` : "--";

    // GF Learning stats
    if (gfLearningData?.metadata) {
        const meta = gfLearningData.metadata;
        // v33.0: Show valid/total split and hard/soft flags in dashboard
        const dashValid = meta.validValidations || (meta.totalValidations - (meta.hardFlaggedValidations || meta.flaggedValidations || 0));
        document.getElementById("dash-gf-validations").textContent =
            `${dashValid} valid / ${meta.totalValidations || 0} total`;
        document.getElementById("dash-gf-error").textContent = meta.avgErrorPercent ?
            `${meta.avgErrorPercent.toFixed(0)}%` : "--";
        const hardCount = meta.hardFlaggedValidations || meta.flaggedValidations || 0;
        const softCount = meta.softFlaggedValidations || 0;
        document.getElementById("dash-flagged").textContent = `${hardCount} hard / ${softCount} soft`;
        document.getElementById("dash-runs").textContent = meta.consecutiveRuns || "--";
    }

    // Ice-affected gauges
    const iceGauges = [];
    for (const [id, d] of Object.entries(data)) {
        if (d?.iceAffected && GAUGES[id]) {
            iceGauges.push(GAUGES[id].name);
        }
    }
    if (iceGauges.length > 0) {
        document.getElementById("dash-ice-row").style.display = "block";
        document.getElementById("dash-ice-list").textContent = iceGauges.join(", ");
    } else {
        document.getElementById("dash-ice-row").style.display = "none";
    }

    // Last fetch time
    if (lastFetchTime) {
        document.getElementById("dash-last-fetch").textContent = new Date(lastFetchTime).toLocaleTimeString();
    }
}

// ==================== UPDATE LEARNING UI ====================

export function updateLearningUI() {
    if (!learningData) return;

    // Update admin dashboard
    updateAdminDashboard();

    const gaugesWithCorrections = Object.keys(learningData.corrections).length;

    // Update learning tab
    document.getElementById("learnTotal").textContent = learningData.totalObs.toLocaleString();

    const startDate = new Date(learningData.startDate);
    const daysSince = Math.floor((Date.now() - startDate) / 86400000);
    document.getElementById("learnSince").textContent = daysSince > 0 ? `${daysSince} days ago` : "Today";

    document.getElementById("learnAccuracy").textContent =
        gaugesWithCorrections === 0 ? "Waiting for rise events..." :
        gaugesWithCorrections < 5 ? `Calibrating (${gaugesWithCorrections} gauges)` :
        "Model calibrated";

    document.getElementById("learnGauges").textContent =
        `${gaugesWithCorrections} / ${Object.keys(GAUGES).length - 1}`;

    // Update correction list
    const list = document.getElementById("correctionList");
    list.textContent = ''; // Clear existing content
    const corrections = Object.entries(learningData.corrections);
    if (corrections.length === 0) {
        const p = document.createElement('p');
        p.style.color = 'var(--text-muted)';
        p.style.fontSize = '0.6rem';
        p.textContent = 'Corrections calculated after detecting rise events at gauges and matching arrivals at Little Falls';
        list.appendChild(p);
    } else {
        for (const [id, factor] of corrections) {
            const g = GAUGES[id];
            const obs = learningData.observations[id] || [];
            const rises = obs.filter(o => o.rising).length;
            const diff = ((factor - 1) * 100).toFixed(1);
            const sign = factor >= 1 ? "+" : "";

            const div = document.createElement('div');
            div.className = 'correction-item';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'gauge-name';
            nameSpan.textContent = g?.name || id;

            const factorSpan = document.createElement('span');
            factorSpan.className = 'factor';
            factorSpan.textContent = factor.toFixed(3) + '× (' + sign + diff + '%) • ' + rises + ' rises';

            div.appendChild(nameSpan);
            div.appendChild(factorSpan);
            list.appendChild(div);
        }
    }

    // Update shadow model horse race display
    updateShadowModelUI();

    // Update shadow leaderboard
    updateShadowLeaderboardUI();
}

// ==================== SHADOW MODEL UI ====================

export function updateShadowModelUI() {
    // Only update if Learning tab is unlocked (elements exist in DOM)
    const prodEl = document.getElementById('shadow-prod-cfs');
    if (!prodEl) return;

    // Production reference
    if (gfEstimate?.cfs) {
        prodEl.textContent = gfEstimate.cfs.toLocaleString();
        document.getElementById('shadow-prod-stage').textContent = (gfEstimate.stage || 0).toFixed(2) + ' ft';
    }

    const prodCFS = gfEstimate?.cfs || 0;

    // Helper: format delta vs production
    function formatDelta(shadowCFS) {
        if (!shadowCFS || !prodCFS) return '--';
        const diff = shadowCFS - prodCFS;
        const pct = ((diff / prodCFS) * 100).toFixed(1);
        const sign = diff >= 0 ? '+' : '';
        return `${sign}${diff.toLocaleString()} cfs (${sign}${pct}%)`;
    }

    // LF Feedback
    if (shadowResults.lfFeedback.cfs !== null) {
        document.getElementById('shadow-lf-cfs').textContent = shadowResults.lfFeedback.cfs.toLocaleString();
        document.getElementById('shadow-lf-stage').textContent = (shadowResults.lfFeedback.stage || 0).toFixed(2) + ' ft';
        document.getElementById('shadow-lf-delta').textContent = formatDelta(shadowResults.lfFeedback.cfs);
    }

    // Online Regression
    if (shadowResults.onlineRegression.cfs !== null) {
        document.getElementById('shadow-reg-cfs').textContent = shadowResults.onlineRegression.cfs.toLocaleString();
        document.getElementById('shadow-reg-stage').textContent = (shadowResults.onlineRegression.stage || 0).toFixed(2) + ' ft';
        document.getElementById('shadow-reg-delta').textContent = formatDelta(shadowResults.onlineRegression.cfs);
    }

    // Kalman Filter
    if (shadowResults.kalman.cfs !== null) {
        document.getElementById('shadow-kal-cfs').textContent = shadowResults.kalman.cfs.toLocaleString();
        document.getElementById('shadow-kal-stage').textContent = (shadowResults.kalman.stage || 0).toFixed(2) + ' ft';
        document.getElementById('shadow-kal-delta').textContent = formatDelta(shadowResults.kalman.cfs);
    }

    // Diagnostics
    const lfState = shadowModelState.lfFeedback;
    document.getElementById('shadow-diag-lf').textContent =
        `Correction: ${(lfState.correctionFactor * 100).toFixed(1)}% | α: ${lfState.alpha} | Pending: ${lfState.lastPredictedLF ? lfState.lastPredictedLF.toLocaleString() + ' cfs' : 'none'}`;

    const regState = shadowModelState.onlineRegression;
    if (regState.weights) {
        const wStr = regState.weights.map(w => w.toFixed(3)).join(', ');
        document.getElementById('shadow-diag-reg').textContent =
            `W: [${wStr}] | Train: ${regState.trainCount} | LR: ${(regState.learningRate / (1 + regState.trainCount * 0.0001)).toFixed(6)}`;
    }

    const kalState = shadowModelState.kalman;
    if (kalState.initialized) {
        document.getElementById('shadow-diag-kal').textContent =
            `State: ${Math.round(kalState.x).toLocaleString()} cfs | P: ${Math.round(Math.sqrt(kalState.P)).toLocaleString()} cfs (1σ) | Q_base: ${kalState.Q_base}`;
    }

    // Update leaderboard when shadow models refresh
    updateShadowLeaderboardUI();
}

// ==================== SHADOW LEADERBOARD UI ====================

export function updateShadowLeaderboardUI() {
    const container = document.getElementById('shadow-leaderboard');
    const header = document.getElementById('shadow-leaderboard-header');
    if (!container) return;

    if (!shadowLeaderboard || !shadowLeaderboard.totalRounds) {
        container.textContent = 'Awaiting validated predictions...';
        if (header) header.textContent = 'LEADERBOARD (awaiting validated predictions)';
        return;
    }

    if (header) {
        header.textContent = `LEADERBOARD (${shadowLeaderboard.totalRounds} round${shadowLeaderboard.totalRounds === 1 ? '' : 's'})`;
    }

    const modelLabels = {
        production: { name: 'Production', color: 'var(--accent-green)' },
        lfFeedback: { name: 'LF Feedback', color: 'var(--accent-sky)' },
        onlineRegression: { name: 'Online Regression', color: 'var(--accent-amber)' },
        kalman: { name: 'Kalman Filter', color: 'var(--accent-purple)' }
    };
    const medals = ['1st', '2nd', '3rd', '4th'];

    // Rank models by meanAbsErrorPercent (lowest = best), skip models with no data
    const ranked = Object.entries(shadowLeaderboard.models)
        .filter(([, m]) => m.count > 0)
        .sort((a, b) => a[1].meanAbsErrorPercent - b[1].meanAbsErrorPercent);

    container.textContent = '';

    ranked.forEach(([key, model], idx) => {
        const label = modelLabels[key] || { name: key, color: 'var(--text-tertiary)' };
        const isWinner = key === shadowLeaderboard.lastWinner;

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:3px 0;';
        if (idx === 0) row.style.borderBottom = '1px solid var(--bg-surface)';

        const left = document.createElement('span');
        left.style.color = label.color;
        left.textContent = `${medals[idx] || ''} ${label.name}`;

        const right = document.createElement('span');
        right.style.color = 'var(--text-tertiary)';
        right.textContent = `${model.meanAbsErrorPercent.toFixed(1)}% avg | n=${model.count}${isWinner ? ' \u2190 last winner' : ''}`;

        row.appendChild(left);
        row.appendChild(right);
        container.appendChild(row);
    });

    // Footer
    if (shadowLeaderboard.lastValidationTime) {
        const footer = document.createElement('div');
        footer.style.cssText = 'font-size:0.4rem;color:var(--text-faint);text-align:center;margin-top:6px;';
        footer.textContent = `Last scored: ${new Date(shadowLeaderboard.lastValidationTime).toLocaleString()}`;
        container.appendChild(footer);
    }
}

// ==================== RESET SHADOW MODELS ====================

export function resetShadowModels() {
    if (!confirm('Reset all shadow models? Learned state (Kalman covariance, regression weights, LF feedback) will be lost.')) return;
    setShadowModelState({
        lfFeedback: { correctionFactor: 0, lastPredictedLF: null, lastPredictionTime: null, alpha: 0.4 },
        onlineRegression: { weights: null, learningRate: 0.001, nFeatures: 9, trainCount: 0 },
        kalman: { x: null, P: null, Q_base: 0.0001, initialized: false }
    });
    setShadowResults({
        lfFeedback: { cfs: null, stage: null, label: 'LF Feedback' },
        onlineRegression: { cfs: null, stage: null, label: 'Online Regression' },
        kalman: { cfs: null, stage: null, label: 'Kalman Filter' }
    });
    localStorage.removeItem(SHADOW_STATE_KEY);
    updateShadowModelUI();
    console.log('🏇 Shadow models reset');
}

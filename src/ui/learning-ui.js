// Potomac Pulse — Learning UI (admin dashboard, GF learning, shadow models, health)
// Extracted from index.html inline script

import { GAUGES, SHADOW_STATE_KEY, SYNC_API } from '../model/constants.js';
import {
    data,
    gfLearningData, gfEstimate,
    edwardsFerryData, lastFetchTime,
    shadowModelState, shadowResults, setShadowModelState, setShadowResults,
    shadowLeaderboard
} from '../state/store.js';
import { mergeValidationReadings, summarizeValidations } from './validation-merge.js';

// ==================== UPDATE GF LEARNING UI ====================

/**
 * Refreshes the GF learning validation status text on the GF and Learning tabs,
 * then triggers updates to the health stats, bin-stats table, and validation chart.
 * @returns {void}
 */
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

    renderValidationChart().catch(e => console.error('Validation chart error:', e));
}

// ==================== HEALTH STATS ====================

/**
 * Renders the scheduled-function health stats (last run, consecutive/missed runs,
 * pending count, and a status explanation) into the Learning tab, color-coded by threshold.
 * @param {object} meta - GF learning metadata (lastPrediction, consecutiveRuns, missedRuns, etc.).
 * @param {number} pendingCount - Number of pending (not-yet-validated) predictions.
 * @returns {void}
 */
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

/**
 * Builds and renders the GF correction-bin statistics table (flow bins × rising/steady/falling
 * observation counts, color-coded) plus a reset-info line, into the Learning tab container.
 * @returns {void}
 */
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
    /**
     * Maps an observation count to a CSS color variable (green ≥5, amber >0, muted otherwise).
     * @param {number} n - Observation count for a bin/state cell.
     * @returns {string} CSS color variable string.
     */
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

// ==================== ADMIN DASHBOARD ====================

/**
 * Populates the admin dashboard with current gauge readings (LF, PoR, Monocacy, Goose,
 * Edwards Ferry), the GF estimate, travel time, GF learning stats, ice-affected gauges,
 * and the last fetch time. Reads from the global state store; no-ops if the dashboard is unrendered.
 * @returns {void}
 */
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

        // v37.7 (#16): surface captured-but-previously-hidden diagnostics (all already loaded here).
        const agoStr = (iso) => {
            const ms = Date.now() - Date.parse(iso);
            if (!Number.isFinite(ms)) return null;
            const h = ms / 3600000;
            return h < 1 ? `${Math.round(ms / 60000)}m ago` : h < 48 ? `${Math.round(h)}h ago` : `${(h / 24).toFixed(1)}d ago`;
        };
        document.getElementById("dash-throughput").textContent =
            `${meta.totalPredictions || 0} pred / ${meta.totalValidations || 0} val`;
        // v37.19 (TODO #27): the headline reads the CLEAN series, which excludes the hard-flagged
        // observations the learner itself rejects (the old `avgStageError` averaged over them — 313
        // vs the bins' 295 at the time of the fix). The legacy value is frozen, not deleted, and is
        // shown after a dot as an audit trail while the clean series builds up from n=0.
        //
        // The denominator MUST come from the latched `legacyStageObs`, never from `stageValidations`:
        // the latter keeps incrementing every hour, so pairing it with a frozen average would show a
        // frozen numerator against a live denominator — a number that never existed. Fall back to
        // omitting `n=` entirely rather than borrowing the live counter.
        const stEl = document.getElementById("dash-stage-err");
        const cleanN = meta.stageObsClean || 0;
        const frozenAvg = meta.legacyStageAvg ?? meta.avgStageError;
        const frozenN = meta.legacyStageObs;
        const legacy = (frozenAvg != null)
            ? ` · was ±${frozenAvg.toFixed(2)}${frozenN != null ? ` (n=${frozenN}` : " ("}, frozen)` : "";
        stEl.textContent = (meta.avgStageErrorClean != null)
            ? `±${meta.avgStageErrorClean.toFixed(2)} ft (n=${cleanN})${legacy}`
            : (legacy ? `-- (clean series building)${legacy}` : "--");
        const bwFail = meta.binWriteFailures || 0;
        const bwEl = document.getElementById("dash-binwrite");
        bwEl.textContent = `${meta.binWriteSuccesses || 0} ok / ${bwFail} fail`;
        bwEl.style.color = bwFail > 0 ? "var(--accent-red-light)" : "var(--text-tertiary)";
        document.getElementById("dash-binwrite-err").textContent = (bwFail > 0 && meta.lastBinError) ? meta.lastBinError : "";
        // v37.17: the stage_* bins only receive a validation when a predicted AND actual gauge height
        // both exist; otherwise the CFS bin learns alone and nothing counted the difference.
        // Two DIFFERENT well-defined quantities are shown, not one number twice:
        //   noStagePair  = totalValidations - stageValidations  — every validation with a null stage
        //                  pair, hard-flagged or not. Derived, so it covers history the counter cannot,
        //                  but scoped to the last metadata reset (both fields are dropped together by
        //                  resetGFLearning, which replaces the whole metadata object).
        //   stageSkipped = the NON-hard-flagged subset, i.e. the ones that actually learned the CFS
        //                  bin without a stage counterpart. Forward-only, starts at 0 in v37.17.
        // They differ by the hard-flagged-and-null-stage count (0 live today). Informational, not a
        // fault: rendered neutral rather than amber so it cannot read as a standing alarm.
        const noStagePair = Math.max(0, (meta.totalValidations || 0) - (meta.stageValidations || 0));
        const stageSkipped = meta.stageSkipped || 0;
        const skEl = document.getElementById("dash-stage-skips");
        if (skEl) skEl.textContent = `${noStagePair} no stage pair / ${stageSkipped} skipped learning`;
        const flagAgo = meta.lastFlagged ? agoStr(meta.lastFlagged) : null;
        document.getElementById("dash-lastflag").textContent = flagAgo || "none";
        document.getElementById("dash-lastflag-reason").textContent = (flagAgo && meta.lastFlaggedReason) ? meta.lastFlaggedReason : "";
    }

    // EF stage→CFS regression quality (gap #4 — already loaded in gfLearningData.efCorrelation).
    const efR2El = document.getElementById("dash-ef-r2");
    if (efR2El) {
        const efc = gfLearningData?.efCorrelation;
        efR2El.textContent = (efc && typeof efc.rSquared === "number")
            ? `R²=${efc.rSquared.toFixed(3)} (n=${efc.count || 0})`
            : "--";
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

/**
 * Orchestrates the full Learning tab refresh: updates the admin dashboard, the shadow-model
 * horse-race display, and the shadow leaderboard.
 * @returns {void}
 */
export function updateLearningUI() {
    // Update admin dashboard
    updateAdminDashboard();

    // Update shadow model horse race display
    updateShadowModelUI();

    // Update shadow leaderboard
    updateShadowLeaderboardUI();
}

// ==================== SHADOW MODEL UI ====================

/**
 * Renders the shadow-model horse-race panel: production reference, each shadow model's
 * CFS/stage and delta vs production (LF Feedback, Online Regression, Kalman), and per-model
 * diagnostics, then refreshes the leaderboard. No-ops if the Learning tab is locked.
 * @returns {void}
 */
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
    /**
     * Formats a shadow model's CFS difference from the production estimate as a signed
     * "cfs (pct%)" string, or '--' when either value is missing.
     * @param {number} shadowCFS - The shadow model's estimated discharge in cfs.
     * @returns {string} Signed delta string, e.g. "+1,200 cfs (+5.0%)", or '--'.
     */
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

/**
 * Renders the shadow-model leaderboard: ranks models by mean absolute error percent
 * (best first), shows medals, per-model error/count, the last-winner marker, and a
 * last-scored footer. Shows an "awaiting" message when no validated rounds exist.
 * @returns {void}
 */
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

// ==================== VALIDATION ACCURACY CHART ====================

let _valChartData = null;
let _valChartFetching = false;

/**
 * Fetches validation history (cached after first load) and draws an SVG line chart of
 * predicted vs actual CFS over time with grid lines, axis labels, an accuracy summary,
 * and interactive hover tooltips. No-ops if the chart elements are absent.
 * @returns {Promise<void>} Resolves when the chart has been rendered (or skipped).
 */
async function renderValidationChart() {
    const svg = document.getElementById('valChartSvg');
    const summary = document.getElementById('valAccuracySummary');
    if (!svg || !summary) return;

    if (!_valChartData && !_valChartFetching) {
        _valChartFetching = true;
        try {
            // History is load-bearing: on failure nothing is cached, so the next render retries
            // (pre-v37.12 behavior). The failures fetch degrades to [] — a flaky log may hide
            // hollow points for the session but never blanks the chart (v37.12).
            const [histResp, failResp] = await Promise.all([
                fetch('/.netlify/functions/sync-learning?endpoint=validation-history'),
                fetch('/.netlify/functions/sync-learning?endpoint=validation-failures').catch(() => null)
            ]);
            if (histResp.ok) {
                const histJson = await histResp.json();
                let failures = [];
                if (failResp && failResp.ok) {
                    try {
                        failures = (await failResp.json()).entries || [];
                    } catch (e) {
                        console.error('Validation failures parse error:', e);
                    }
                }
                _valChartData = mergeValidationReadings(histJson.readings || [], failures, Date.now());
            }
        } catch (e) {
            console.error('Validation history fetch error:', e);
        }
        _valChartFetching = false;
    }

    const readings = _valChartData;
    if (!readings || readings.length === 0) {
        summary.textContent = 'Collecting validation data — chart appears after first validation';
        svg.innerHTML = '';
        return;
    }

    const unflagged = readings.filter(r => !r.hardFlagged);
    const { unflaggedCount, flaggedCount, avgAbsErrorPct, spanHours } = summarizeValidations(readings, Date.now());
    if (avgAbsErrorPct === null) {
        summary.textContent = `${flaggedCount} hard-flagged validation${flaggedCount === 1 ? '' : 's'} shown as hollow points — no clean validations yet`;
    } else {
        const flaggedNote = flaggedCount > 0 ? ` · ${flaggedCount} hard-flagged ○ excluded from avg` : '';
        summary.textContent = `Avg error: ±${avgAbsErrorPct.toFixed(1)}% (${unflaggedCount} validations over ${spanHours}h)${flaggedNote}`;
    }

    const container = document.getElementById('valChartContainer');
    const width = container.clientWidth - 16;
    const height = 160;
    const padding = { top: 12, right: 10, bottom: 22, left: 45 };
    const graphWidth = width - padding.left - padding.right;
    const graphHeight = height - padding.top - padding.bottom;

    // y-domain from clean validations only — a corrupt hard-flagged actual must not squash
    // the real series; out-of-range flagged markers are clamped to the plot edge instead.
    const domainSource = unflagged.length > 0 ? unflagged : readings;
    const allCFS = domainSource.flatMap(r => [r.predictedCFS, r.actualCFS]);
    const minCFS = Math.min(...allCFS) * 0.9;
    const maxCFS = Math.max(...allCFS) * 1.1;
    const cfsRange = maxCFS - minCFS || 1;

    const minTime = readings[0].timestamp;
    const maxTime = readings[readings.length - 1].timestamp;
    const timeRange = maxTime - minTime || 1;

    const xScale = t => padding.left + ((t - minTime) / timeRange) * graphWidth;
    const yScale = c => padding.top + (1 - (c - minCFS) / cfsRange) * graphHeight;
    const bottom = padding.top + graphHeight;

    const yTicks = [];
    const tickStep = cfsRange > 10000 ? 5000 : cfsRange > 5000 ? 2000 : cfsRange > 2000 ? 1000 : 500;
    for (let c = Math.ceil(minCFS / tickStep) * tickStep; c <= maxCFS; c += tickStep) {
        yTicks.push(c);
    }

    const xLabels = [];
    const dayMs = 86400000;
    const startDay = new Date(minTime);
    startDay.setHours(0, 0, 0, 0);
    for (let t = startDay.getTime(); t <= maxTime + dayMs; t += dayMs) {
        if (t >= minTime && t <= maxTime) {
            const d = new Date(t);
            xLabels.push({ t, label: `${d.getMonth() + 1}/${d.getDate()}` });
        }
    }

    // Line paths connect clean validations only — a hard-flagged actual is by definition a
    // suspect reading, and a line through it would draw a river trace that never happened.
    const predPath = unflagged.map((r, i) => `${i === 0 ? 'M' : 'L'} ${xScale(r.timestamp)},${yScale(r.predictedCFS)}`).join(' ');
    const actualPath = unflagged.map((r, i) => `${i === 0 ? 'M' : 'L'} ${xScale(r.timestamp)},${yScale(r.actualCFS)}`).join(' ');
    const flagged = readings.filter(r => r.hardFlagged);
    const yPlot = c => Math.max(padding.top, Math.min(bottom, yScale(c)));

    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.innerHTML = `
        ${yTicks.map(c => `<line x1="${padding.left}" y1="${yScale(c)}" x2="${width - padding.right}" y2="${yScale(c)}" stroke="#334155" stroke-width="1" stroke-dasharray="2,2"/>`).join('')}
        ${xLabels.map(l => `<line x1="${xScale(l.t)}" y1="${padding.top}" x2="${xScale(l.t)}" y2="${bottom}" stroke="#334155" stroke-width="1" stroke-dasharray="2,2"/>`).join('')}
        <path d="${predPath}" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linejoin="round"/>
        <path d="${actualPath}" fill="none" stroke="#4ade80" stroke-width="2" stroke-linejoin="round"/>
        ${unflagged.map(r => `<circle cx="${xScale(r.timestamp)}" cy="${yScale(r.predictedCFS)}" r="3" fill="#60a5fa" stroke="#0f172a" stroke-width="1"/>`).join('')}
        ${unflagged.map(r => `<circle cx="${xScale(r.timestamp)}" cy="${yScale(r.actualCFS)}" r="3" fill="#4ade80" stroke="#0f172a" stroke-width="1"/>`).join('')}
        ${flagged.map(r => `<circle cx="${xScale(r.timestamp)}" cy="${yPlot(r.predictedCFS)}" r="3.5" fill="none" stroke="#60a5fa" stroke-width="1.75"/>`).join('')}
        ${flagged.map(r => `<circle cx="${xScale(r.timestamp)}" cy="${yPlot(r.actualCFS)}" r="3.5" fill="none" stroke="#4ade80" stroke-width="1.75"/>`).join('')}
        ${yTicks.map(c => `<text x="${padding.left - 4}" y="${yScale(c) + 3}" fill="#94a3b8" font-size="8" text-anchor="end">${(c / 1000).toFixed(1)}k</text>`).join('')}
        ${xLabels.map(l => `<text x="${xScale(l.t)}" y="${height - 4}" fill="#94a3b8" font-size="8" text-anchor="middle">${l.label}</text>`).join('')}
        <text x="8" y="${padding.top + graphHeight / 2}" fill="#94a3b8" font-size="8" text-anchor="middle" transform="rotate(-90, 8, ${padding.top + graphHeight / 2})">CFS</text>
        <rect id="valChartHover" x="${padding.left}" y="${padding.top}" width="${graphWidth}" height="${graphHeight}" fill="transparent"/>
    `;

    const hoverRect = document.getElementById('valChartHover');
    const tooltip = document.getElementById('valChartTooltip');

    /**
     * Shows the validation-chart tooltip for the reading nearest the pointer/touch x-position,
     * populating time, predicted, actual, and signed error fields and positioning the tooltip.
     * @param {MouseEvent|TouchEvent} e - The mousemove or touchmove event over the chart.
     * @returns {void}
     */
    function showValTooltip(e) {
        const rect = svg.getBoundingClientRect();
        const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
        const t = minTime + ((x - padding.left) / graphWidth) * timeRange;

        const closest = readings.reduce((prev, curr) =>
            Math.abs(curr.timestamp - t) < Math.abs(prev.timestamp - t) ? curr : prev
        );

        document.getElementById('valTooltipTime').textContent = new Date(closest.timestamp).toLocaleString();
        document.getElementById('valTooltipPred').textContent = closest.predictedCFS.toLocaleString() + ' cfs';
        document.getElementById('valTooltipActual').textContent = closest.actualCFS.toLocaleString() + ' cfs';
        const errSign = closest.errorPercent >= 0 ? '+' : '';
        const flagNote = closest.hardFlagged ? ' · ⚠ hard-flagged (excluded from learning & avg)' : '';
        document.getElementById('valTooltipError').textContent = `${errSign}${closest.errorPercent.toFixed(1)}%${flagNote}`;

        const tooltipX = Math.min(width - 120, Math.max(10, xScale(closest.timestamp) - 50));
        const tooltipY = Math.min(height - 70, Math.max(5, Math.min(yScale(closest.predictedCFS), yScale(closest.actualCFS)) - 65));
        tooltip.style.left = tooltipX + 'px';
        tooltip.style.top = tooltipY + 'px';
        tooltip.style.display = 'block';
    }

    /**
     * Hides the validation-chart hover tooltip.
     * @returns {void}
     */
    function hideValTooltip() {
        tooltip.style.display = 'none';
    }

    hoverRect.onmousemove = showValTooltip;
    hoverRect.ontouchmove = showValTooltip;
    hoverRect.onmouseleave = hideValTooltip;
    hoverRect.ontouchend = hideValTooltip;
}

// ==================== RESET SHADOW MODELS ====================

/**
 * Prompts for confirmation, then resets all shadow-model learned state and results to
 * defaults, clears the persisted state from localStorage, and refreshes the shadow UI.
 * @returns {void}
 */
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

// ==================== BACKUP EXPORT (v37.6) ====================

/**
 * Fetches the current server-side learning state fresh (GF correction bins + metadata + EF correlation +
 * shadow leaderboard via the `gf` endpoint, plus forecast accuracy) and triggers a browser download of it
 * as a timestamped JSON backup. Read-only — does not modify any learning data on the server.
 * @returns {Promise<void>}
 */
export async function downloadLearningBackup() {
    const btn = document.getElementById('downloadBackupBtn');
    const label = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Exporting...'; }
    try {
        // Fetch fresh so the backup reflects current server state, not page-load state.
        const [gfRes, faRes] = await Promise.all([
            fetch(SYNC_API + '?endpoint=gf'),
            fetch(SYNC_API + '?endpoint=forecast-accuracy'),
        ]);
        if (!gfRes.ok) throw new Error(`GF endpoint returned ${gfRes.status}`);
        const gf = await gfRes.json();
        const forecastAccuracy = faRes.ok ? await faRes.json() : null;

        const version = (document.title.match(/v[\d.]+/) || ['unknown'])[0];
        const payload = {
            app: 'Potomac Pulse',
            kind: 'learning-backup',
            version,
            exportedAt: new Date().toISOString(),
            endpoints: { gf, forecastAccuracy },
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `potomac-pulse-learning-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log('💾 Learning backup exported');
    } catch (e) {
        console.error('Backup export failed:', e);
        alert('Backup export failed: ' + (e.message || e));
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = label; }
    }
}

// ==================== ADMIN AUDIT LOG (v37.8 #17) ====================

/**
 * Fetches recent admin-action audit entries and renders them into #auditLog (newest first).
 * Read-only; no-op if the element is absent (learning locked) and shows a fallback on fetch failure.
 * @returns {Promise<void>}
 */
export async function renderAuditLog() {
    const el = document.getElementById('auditLog');
    if (!el) return;
    try {
        const res = await fetch(SYNC_API + '?endpoint=audit-log');
        if (!res.ok) throw new Error(`audit-log returned ${res.status}`);
        const { entries } = await res.json();
        if (!entries || entries.length === 0) {
            el.innerHTML = '<p style="color:var(--text-muted);margin:0;">No admin actions recorded.</p>';
            return;
        }
        el.innerHTML = entries.map(e => {
            const when = e.at ? new Date(e.at).toLocaleString() : '?';
            const det = (e.details && typeof e.details === 'object')
                ? Object.entries(e.details).map(([k, v]) => `${k}: ${v}`).join(', ')
                : '';
            return `<div style="margin-bottom:4px;"><span style="color:var(--text-tertiary);">${when}</span> · <b style="color:var(--accent-amber);">${e.action || '?'}</b>${det ? ` · <span style="color:var(--text-muted);">${det}</span>` : ''}</div>`;
        }).join('');
    } catch (err) {
        console.warn('Audit log render failed:', err);
        el.innerHTML = '<p style="color:var(--text-muted);margin:0;">Audit log unavailable.</p>';
    }
}

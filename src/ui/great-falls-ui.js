// Potomac Pulse — Great Falls UI (estimation display + forecast periods)
// Extracted from index.html inline script

import {
    LF, TRAVEL_POR_GF_BASELINE, TRAVEL_GF_LF_BASELINE,
    EF_MODEL, FORECAST_HORIZONS
} from '../model/constants.js';

import {
    getFlowMultiplier, estimateLFStage, getEFWeight
} from '../model/shared-model.js';

import {
    data, gfEstimate, setGfEstimate,
    edwardsFerryData, waterTempC,
    gfDataReady, gfLearningData, gfHistory,
    forecastAccuracyData
} from '../state/store.js';

import { estimateGreatFalls, getPoRFromHoursAgo, getPoRRiseRate } from '../estimation/great-falls.js';
import { estimateGFFromEdwardsFerry } from '../estimation/edwards-ferry.js';
import { runShadowModels } from '../estimation/shadow-models.js';
import { recordGFEstimate } from '../data/history.js';
import { fmtArrival } from '../data/fetch.js';
import { storeForecastPredictions } from '../learning/gf-learning.js';
import { renderForecastGraph, getForecastGraphData, getGraphScales } from '../ui/forecast-graph.js';
import { updateShadowModelUI } from '../ui/learning-ui.js';
import { dropLocalSpikes } from '../estimation/rise-rate-robust.mjs';

// Forward declaration
let _updateGFLearningUI = null;
export function setUpdateGFLearningUIRef(fn) { _updateGFLearningUI = fn; }

// ==================== MAIN GF UI UPDATE ====================

export function updateGreatFallsUI() {
    if (!document.getElementById("gf-cfs")) return; // DOM not ready
    // Show loading state until GF corrections AND Edwards Ferry data are loaded
    // This prevents the GF value from "jumping" when EF arrives
    const efReady = edwardsFerryData.current !== null;
    if (!gfDataReady || !efReady) {
        document.getElementById("gf-cfs").textContent = "...";
        document.getElementById("gf-stage").textContent = "...";
        document.getElementById("gf-trend").textContent = "";
        document.getElementById("gf-data-source").textContent = !gfDataReady ? "Loading corrections..." : "Loading EF data...";
        document.getElementById("gf-confidence").textContent = "";
        document.getElementById("gf-ci-range").style.display = 'none';
        document.getElementById("gf-forecast-cfs").textContent = "--";
        document.getElementById("gf-forecast-stage").textContent = "--";
        document.getElementById("gf-forecast-hrs").textContent = "--";
        return;
    }

    setGfEstimate(estimateGreatFalls());

    if (!gfEstimate) {
        // Check if this is due to ice-affected critical gauges
        const por = data["01638500"];
        const lf = data["01646500"];
        const isIceIssue = por?.iceAffected || lf?.iceAffected;

        document.getElementById("gf-cfs").textContent = "--";
        document.getElementById("gf-stage").textContent = "--";

        if (isIceIssue) {
            document.getElementById("gf-estimate-label").textContent = "UNAVAILABLE";
            document.getElementById("gf-estimate-label").style.color = "var(--accent-blue)";
            const trendEl = document.getElementById("gf-trend");
            trendEl.textContent = "❄️ Ice conditions";
            trendEl.style.color = "var(--accent-blue)";
            document.getElementById("gf-data-source").textContent = "Critical gauges ice-affected — estimate suspended";
        } else {
            document.getElementById("gf-trend").textContent = "Waiting for data...";
            document.getElementById("gf-data-source").textContent = "Waiting for data...";
        }

        document.getElementById("gf-confidence").textContent = "Confidence: --";
        document.getElementById("gf-ci-range").style.display = 'none';
        document.getElementById("gf-forecast-cfs").textContent = "--";
        document.getElementById("gf-forecast-stage").textContent = "--";
        document.getElementById("gf-forecast-hrs").textContent = "--";
        return;
    }

    // Record GF estimate for forecast graph history (stores actual full-model output)
    recordGFEstimate(gfEstimate.cfs, gfEstimate.stage);

    // Run shadow models (horse race) — display-only, never affects production
    runShadowModels(gfEstimate);
    updateShadowModelUI();

    // Main display - "ESTIMATED NOW" section
    document.getElementById("gf-cfs").textContent = gfEstimate.cfs.toLocaleString();

    // Show stage (clean number only)
    const stageEl = document.getElementById("gf-stage");
    stageEl.textContent = gfEstimate.stage.toFixed(2);

    // EF-only fallback mode: PoR is ice-affected, using Edwards Ferry model only
    if (gfEstimate.efOnly) {
        document.getElementById("gf-estimate-label").textContent = "❄️ EF-ONLY ESTIMATE";
        document.getElementById("gf-estimate-label").style.color = "var(--accent-blue)";
        document.getElementById("gf-data-source").textContent =
            "PoR ice-affected — using Edwards Ferry model (R²=" + EF_MODEL.rSquared + ")";
        const efTrendEl = document.getElementById("gf-trend");
        const efTrendIcon = gfEstimate.flowState === 'rising' ? '▲' : gfEstimate.flowState === 'falling' ? '▼' : '●';
        efTrendEl.textContent = efTrendIcon + " " + gfEstimate.flowState.toUpperCase() + " (EF trend)";
        efTrendEl.style.color = "var(--accent-blue)";
        document.getElementById("gf-confidence").textContent = "Confidence: LOW (EF only)";
        document.getElementById("gf-forecast-cfs").textContent = "--";
        document.getElementById("gf-forecast-stage").textContent = "--";
        document.getElementById("gf-forecast-hrs").textContent = "--";
        // v32.2: Populate estimation inputs section for EF-only mode
        document.getElementById("gf-input-por").textContent = "❄️ ice-affected";
        document.getElementById("gf-input-monocacy").textContent = "N/A";
        document.getElementById("gf-input-goose").textContent = "N/A";
        document.getElementById("gf-input-broadrun").textContent = "N/A";
        document.getElementById("gf-input-seneca").textContent = "N/A";
        document.getElementById("gf-input-travel").textContent = "N/A";
        document.getElementById("gf-input-travel-gf-lf").textContent = "N/A";
        document.getElementById("gf-input-flowbin").textContent = "N/A — EF only";
        document.getElementById("gf-input-correction").textContent = "N/A — EF only";
        document.getElementById("gf-input-uncertainty").textContent = "N/A — EF only";
        document.getElementById("gf-ef-crosscheck").style.display = 'none';
        document.getElementById("gf-ci-range").style.display = 'none';
        return;
    }

    // Update label and data source based on whether we have time-shifted data
    if (gfEstimate.useTimeShifted) {
        document.getElementById("gf-estimate-label").textContent = "ESTIMATED NOW";
        document.getElementById("gf-estimate-label").style.color = "var(--accent-green)";
        if (gfEstimate.useEfEnsemble && gfEstimate.efWeight) {
            const porPct = Math.round((1 - gfEstimate.efWeight) * 100);
            const efPct = Math.round(gfEstimate.efWeight * 100);
            const delta = gfEstimate.inputs?.porDeltaCorrection;
            const deltaLabel = delta
                ? ` [Δ-corrected ${((delta.rawRatio-1)*100).toFixed(0)}%]`
                : '';
            document.getElementById("gf-data-source").textContent =
                `${porPct}% PoR (${gfEstimate.timeShiftedHoursAgo.toFixed(0)}h ago)${deltaLabel} + ${efPct}% EF → LF in ~${gfEstimate.inputs.travelGFtoLF.toFixed(1)} hrs`;
        } else {
            document.getElementById("gf-data-source").textContent =
                `PoR from ${gfEstimate.timeShiftedHoursAgo.toFixed(1)} hrs ago → arrives at LF in ~${gfEstimate.inputs.travelGFtoLF.toFixed(1)} hrs`;
        }
    } else {
        document.getElementById("gf-estimate-label").textContent = "FORECAST (no history yet)";
        document.getElementById("gf-estimate-label").style.color = "var(--accent-amber)";
        document.getElementById("gf-data-source").textContent =
            `Using current PoR (need ${gfEstimate.inputs.travelPoRtoGF.toFixed(0)}+ hrs of history)`;
    }

    // Flow state with icon
    const stateIcons = { rising: '▲ RISING', falling: '▼ FALLING', steady: '● STEADY' };
    const stateColors = { rising: 'var(--color-rising)', falling: 'var(--color-falling)', steady: 'var(--color-steady)' };
    const trendStateEl = document.getElementById("gf-trend");
    trendStateEl.textContent = stateIcons[gfEstimate.flowState];
    trendStateEl.style.color = stateColors[gfEstimate.flowState];

    // Confidence
    const confColors = { high: 'var(--accent-green)', medium: 'var(--accent-amber)', low: 'var(--accent-red-light)' };
    const confEl = document.getElementById("gf-confidence");
    confEl.textContent = "Confidence: " + gfEstimate.confidence.toUpperCase();
    confEl.style.color = confColors[gfEstimate.confidence];

    // Forecast section
    document.getElementById("gf-forecast-cfs").textContent = gfEstimate.forecastCFS.toLocaleString();
    document.getElementById("gf-forecast-stage").textContent = gfEstimate.forecastStage.toFixed(2);
    document.getElementById("gf-forecast-hrs").textContent = gfEstimate.inputs.travelPoRtoGF.toFixed(1);
    document.getElementById("gf-forecast-arrival").textContent = fmtArrival(gfEstimate.inputs.travelPoRtoGF);

    // Inputs section
    const porInputEl = document.getElementById("gf-input-por");
    if (gfEstimate.inputs.historicPorCFS) {
        porInputEl.textContent = gfEstimate.inputs.historicPorCFS.toLocaleString() + " cfs (" + gfEstimate.timeShiftedHoursAgo.toFixed(1) + "h ago)";
    } else {
        porInputEl.textContent = gfEstimate.inputs.porCFS.toLocaleString() + " cfs (current)";
    }
    document.getElementById("gf-input-monocacy").textContent =
        (gfEstimate.inputs.monocacyActual ? "+ " : "~+ ") + gfEstimate.inputs.monocacyCFS.toLocaleString() + " cfs";
    document.getElementById("gf-input-goose").textContent =
        (gfEstimate.inputs.gooseActual ? "+ " : "~+ ") + gfEstimate.inputs.gooseCFS.toLocaleString() + " cfs";
    document.getElementById("gf-input-broadrun").textContent =
        (gfEstimate.inputs.broadRunActual ? "+ " : "~+ ") + gfEstimate.inputs.broadRunCFS.toLocaleString() + " cfs";
    document.getElementById("gf-input-seneca").textContent =
        (gfEstimate.inputs.senecaActual ? "+ " : "~+ ") + gfEstimate.inputs.senecaCFS.toLocaleString() + " cfs";
    document.getElementById("gf-input-travel").textContent = gfEstimate.inputs.travelPoRtoGF.toFixed(1) + " hrs";
    document.getElementById("gf-input-travel-gf-lf").textContent = gfEstimate.inputs.travelGFtoLF.toFixed(1) + " hrs";

    // Display flow bin with observation count
    const binData = gfLearningData?.correctionBins?.[gfEstimate.inputs.flowBin]?.[gfEstimate.flowState];
    const binCount = binData?.count || 0;
    document.getElementById("gf-input-flowbin").textContent =
        gfEstimate.inputs.flowBin + (binCount > 0 ? ` (${binCount} obs)` : '');

    document.getElementById("gf-input-correction").textContent =
        gfEstimate.inputs.correction === 0 ? "none yet" : (gfEstimate.inputs.correction > 0 ? "-" : "+") + Math.abs(Math.round(gfEstimate.inputs.correction)) + " cfs";

    // Display 90% CI range
    if (gfEstimate.uncertaintyRange) {
        document.getElementById("gf-input-uncertainty").textContent =
            `${gfEstimate.uncertaintyRange.lowCFS.toLocaleString()} – ${gfEstimate.uncertaintyRange.highCFS.toLocaleString()} cfs`;
    } else {
        document.getElementById("gf-input-uncertainty").textContent = "--";
    }

    // Display Edwards Ferry cross-check
    const efCrosscheck = document.getElementById("gf-ef-crosscheck");
    const efEstimateEl = document.getElementById("gf-ef-estimate");
    if (gfEstimate.efEstimate) {
        const efEst = gfEstimate.efEstimate;
        const efStage = estimateLFStage(efEst.cfs);
        const diff = efEst.cfs - gfEstimate.cfs;
        const diffPct = Math.abs((diff / gfEstimate.cfs) * 100);

        let agreementIcon = '✓';
        let agreementColor = 'var(--accent-green)';
        if (diffPct > 15) {
            agreementIcon = '⚠';
            agreementColor = 'var(--accent-loading)';
        }
        if (diffPct > 25) {
            agreementIcon = '✗';
            agreementColor = 'var(--accent-red)';
        }

        efEstimateEl.textContent = efEst.cfs.toLocaleString() + " cfs / " + efStage.toFixed(1) + " ft " + agreementIcon;
        efEstimateEl.style.color = agreementColor;
        efCrosscheck.style.display = 'block';
    } else {
        efCrosscheck.style.display = 'none';
    }

    // Validation countdown
    const valCountdownText = gfEstimate.validationCountdown.toFixed(1) + " hrs";
    document.getElementById("gf-val-countdown").textContent = valCountdownText;
    const learnValCountdown = document.getElementById("learn-val-countdown");
    if (learnValCountdown) learnValCountdown.textContent = valCountdownText;

    // Update map popup values
    const popupCFS = document.getElementById("gf-popup-cfs");
    const popupStage = document.getElementById("gf-popup-stage");
    if (popupCFS) popupCFS.textContent = gfEstimate.cfs.toLocaleString() + " cfs";
    if (popupStage) {
        popupStage.textContent = gfEstimate.stage.toFixed(2) + " ft";
    }

    // Update 48-hour forecast periods (6-hour intervals)
    updateForecastPeriods(gfEstimate);

    // v36.0 (C1): GF prediction storage is now SERVER-ONLY (the hourly cron is the sole writer).
    // The client neither writes predictions nor validates them — it only reads learning data and
    // applies the correction for display. (Forecast predictions are still client-written elsewhere.)

    // Update GF learning status display
    if (_updateGFLearningUI) _updateGFLearningUI();
}

// ==================== FORECAST PERIODS ====================

export function updateForecastPeriods(gfEst) {
    const container = document.getElementById("gf-forecast-periods");
    if (!container || !gfEst) return;

    const periods = [];
    const now = new Date();
    const currentCFS = gfEst.cfs;

    // Get NWS forecast data
    const porData = data['01638500'];
    const efData = data['01644148'];
    const porForecast = porData?.forecast;
    const efForecast = efData?.forecast;
    const hasPoRForecast = porForecast?.data?.length > 0;
    const hasEFForecast = efForecast?.data?.length > 0;
    const hasNWSForecast = hasPoRForecast;

    // Period 0: NOW
    periods.push({
        label: 'Now',
        time: now,
        cfs: currentCFS,
        stage: gfEst.stage,
        isCurrent: true,
        source: 'estimate'
    });

    const calculateHours = [6, 12, 18, 24, 30, 36, 42, 48];
    const displayHours = [6, 12, 24, 48];

    if (hasNWSForecast) {
        const porPoints = porForecast.data.map(p => {
            const validTime = new Date(p.validTime);
            const hoursAhead = (validTime - now) / (1000 * 60 * 60);
            const cfs = (p.secondary || 0) * 1000;
            return { hoursAhead, cfs };
        });

        const efPoints = hasEFForecast ? efForecast.data.map(p => {
            const validTime = new Date(p.validTime);
            const hoursAhead = (validTime - now) / (1000 * 60 * 60);
            return { hoursAhead, stage: p.primary };
        }) : [];

        const interpolateForecast = (points, targetHrs, field = 'cfs') => {
            const before = points.filter(p => p.hoursAhead <= targetHrs).pop();
            const after = points.find(p => p.hoursAhead >= targetHrs);
            if (before && after && before !== after) {
                const t = (targetHrs - before.hoursAhead) / (after.hoursAhead - before.hoursAhead);
                return before[field] + t * (after[field] - before[field]);
            }
            if (after) return after[field];
            if (before) return before[field];
            return null;
        };

        // LF-constrained forecast with additive bias correction
        const currentPorCFS = porData?.q || currentCFS;
        const lfData = data['01646500'];
        const lfForecast = lfData?.forecast;
        const hasLFForecast = lfForecast?.data?.length > 0;
        const observedLfCFS = lfData?.q || currentCFS;

        const lfPoints = hasLFForecast ? lfForecast.data.map(p => {
            const validTime = new Date(p.validTime);
            const hoursAhead = (validTime - now) / (1000 * 60 * 60);
            const cfs = (p.secondary || 0) * 1000;
            return { hoursAhead, cfs, stage: p.primary };
        }) : [];

        // Calculate additive bias correction
        let lfBiasOffset = 0;
        if (hasLFForecast && lfPoints.length > 0) {
            const forecastAtNow = interpolateForecast(lfPoints, 0) || lfPoints[0]?.cfs;
            if (forecastAtNow && observedLfCFS) {
                lfBiasOffset = observedLfCFS - forecastAtNow;
                console.log(`LF bias correction: observed=${observedLfCFS.toFixed(0)} cfs, forecast=${forecastAtNow.toFixed(0)} cfs, offset=${lfBiasOffset.toFixed(0)} cfs`);
            }
        }

        const gfToLfTravel = TRAVEL_GF_LF_BASELINE * getFlowMultiplier(currentCFS).mult;

        const getGFAtTime = (targetGFHrs) => {
            const lfTimeForThisWater = targetGFHrs + gfToLfTravel;
            let rawForecastCFS = null;

            if (hasLFForecast && lfPoints.length > 0) {
                const before = lfPoints.filter(p => p.hoursAhead <= lfTimeForThisWater).pop();
                const after = lfPoints.find(p => p.hoursAhead >= lfTimeForThisWater);
                if (before && after && before !== after) {
                    const t = (lfTimeForThisWater - before.hoursAhead) / (after.hoursAhead - before.hoursAhead);
                    rawForecastCFS = before.cfs + t * (after.cfs - before.cfs);
                } else if (after) {
                    rawForecastCFS = after.cfs;
                } else if (before) {
                    rawForecastCFS = before.cfs;
                }
            }

            if (rawForecastCFS !== null) {
                return Math.max(0, rawForecastCFS + lfBiasOffset);
            }

            // Fallback to PoR forecast
            const porBefore = porPoints.filter(p => p.hoursAhead <= targetGFHrs).pop();
            const porAfter = porPoints.find(p => p.hoursAhead >= targetGFHrs);
            if (porBefore && porAfter && porBefore !== porAfter) {
                const t = (targetGFHrs - porBefore.hoursAhead) / (porAfter.hoursAhead - porBefore.hoursAhead);
                return porBefore.cfs + t * (porAfter.cfs - porBefore.cfs);
            }
            if (porAfter) return porAfter.cfs;
            if (porBefore) return porBefore.cfs;
            return currentPorCFS;
        };

        console.log(`GF forecast: LF-constrained (GF→LF ~${gfToLfTravel.toFixed(1)}h) with additive bias correction`);

        for (const targetHrs of calculateHours) {
            const futureTime = new Date(now.getTime() + targetHrs * 60 * 60 * 1000);
            let porCFS = getGFAtTime(targetHrs);

            let efEstimate = null;
            if (hasEFForecast) {
                const efStage = interpolateForecast(efPoints, targetHrs, 'stage');
                if (efStage && efStage >= EF_MODEL.minStage && efStage <= EF_MODEL.maxStage) {
                    const coef = (waterTempC !== null && waterTempC <= EF_MODEL.coldMaxTemp)
                        ? EF_MODEL.coldCoef : EF_MODEL.coef;
                    const exp = (waterTempC !== null && waterTempC <= EF_MODEL.coldMaxTemp)
                        ? EF_MODEL.coldExp : EF_MODEL.exp;
                    efEstimate = coef * Math.pow(efStage, exp);
                }
            }

            let forecastCFS;
            if (efEstimate !== null) {
                const efWeight = getEFWeight(porCFS);
                forecastCFS = (1 - efWeight) * porCFS + efWeight * efEstimate;
            } else {
                forecastCFS = porCFS;
            }

            const forecastStage = estimateLFStage(forecastCFS);
            const sourceLabel = 'NWS' + (efEstimate !== null ? '+EF' : '');
            const isDisplayPeriod = displayHours.includes(targetHrs);

            let nwsLfRawCFS = null;
            let nwsLfBiasCorrectedCFS = null;
            if (hasLFForecast && lfPoints.length > 0) {
                const rawLf = interpolateForecast(lfPoints, targetHrs);
                if (rawLf && rawLf > 0) {
                    nwsLfRawCFS = Math.round(rawLf);
                    nwsLfBiasCorrectedCFS = Math.round(rawLf + lfBiasOffset);
                }
            }
            const persistenceCFS = Math.round(observedLfCFS);

            periods.push({
                label: `+${targetHrs}h`,
                time: futureTime,
                cfs: Math.round(forecastCFS),
                stage: forecastStage,
                isCurrent: false,
                source: sourceLabel,
                isDisplayPeriod: isDisplayPeriod,
                nwsLfRawCFS: nwsLfRawCFS,
                nwsLfBiasCorrectedCFS: nwsLfBiasCorrectedCFS,
                persistenceCFS: persistenceCFS
            });
        }

        periods.filter(p => !p.isCurrent).forEach(p => {
            console.log(`  ${p.label}: ${p.cfs} cfs / ${p.stage.toFixed(2)} ft${p.isDisplayPeriod ? ' (display)' : ''}`);
        });
    } else {
        // Fallback: Linear extrapolation
        const forecastCFS = gfEst.forecastCFS;
        const travelTime = gfEst.inputs?.travelPoRtoGF || 8.5;
        const cfsDiff = forecastCFS - currentCFS;
        const trendPerHour = cfsDiff / travelTime;

        for (const hrs of calculateHours) {
            const futureTime = new Date(now.getTime() + hrs * 60 * 60 * 1000);
            const dampening = Math.max(0.3, 1 - (hrs / 72));
            const extrapolatedCFS = Math.max(0, currentCFS + (trendPerHour * hrs * dampening));
            const extrapolatedStage = estimateLFStage(extrapolatedCFS);

            periods.push({
                label: `+${hrs}h`,
                time: futureTime,
                cfs: Math.round(extrapolatedCFS),
                stage: extrapolatedStage,
                isCurrent: false,
                source: 'extrapolated',
                isDisplayPeriod: displayHours.includes(hrs)
            });
        }
        console.log('48h forecast: NWS unavailable, using linear extrapolation');
    }

    // Filter periods to display
    const displayPeriods = periods.filter(p => p.isCurrent || p.isDisplayPeriod);

    // Render period cards
    container.innerHTML = displayPeriods.map((p) => {
        const timeStr = p.isCurrent ? 'Now' : formatForecastTime(p.time);
        const trendIcon = p.cfs > currentCFS ? '▲' : (p.cfs < currentCFS ? '▼' : '●');
        const trendColor = p.cfs > currentCFS ? 'var(--color-rising)' : (p.cfs < currentCFS ? 'var(--color-falling)' : 'var(--text-tertiary)');
        const hrs = p.isCurrent ? 0 : parseInt(p.label.replace('+', '').replace('h', ''));

        let sourceIndicator = '';
        if (p.source && !p.isCurrent) {
            const sourceColor = 'var(--accent-blue)';
            const sourceTitle = 'NWS upstream forecast (arrival time varies with flow)';
            sourceIndicator = ` <span class="fp-source" style="color:${sourceColor};" title="${sourceTitle}">${p.source}</span>`;
        }

        return `
            <div class="forecast-period${p.isCurrent ? ' current' : ''}" data-hrs="${hrs}" data-stage="${p.stage.toFixed(2)}" data-cfs="${p.cfs}" style="cursor:pointer;">
                <div class="fp-time">${p.label}${sourceIndicator}<br><span class="fp-subtime">${timeStr}</span></div>
                <div class="fp-stage">${p.stage.toFixed(2)} ft</div>
                <div class="fp-cfs">${p.cfs.toLocaleString()} cfs</div>
                ${!p.isCurrent ? `<div class="fp-trend" style="color:${trendColor}">${trendIcon}</div>` : ''}
            </div>
        `;
    }).join('');

    // Build GF history for graph. Drop isolated local spikes from the PLOT only
    // (display filter — never deletes stored history) so a stale/glitch estimate
    // left in localStorage can't render as a spike. Applied before appending the
    // live "now" point so the current estimate is always shown.
    let gfHistoryPoints = gfHistory.map(entry => {
        const hrsAgo = (Date.now() - entry.timestamp) / 3600000;
        return {
            hrs: -hrsAgo,
            cfs: entry.cfs,
            stage: entry.stage,
            time: new Date(entry.timestamp),
            isHistory: true
        };
    }).sort((a, b) => a.hrs - b.hrs);

    gfHistoryPoints = dropLocalSpikes(gfHistoryPoints, { frac: 0.40, key: 'cfs' });

    if (gfHistoryPoints.length > 0) {
        gfHistoryPoints.push({
            hrs: 0,
            cfs: currentCFS,
            stage: gfEst.stage,
            time: new Date(),
            isHistory: true
        });
    }

    // Render interactive graph
    renderForecastGraph(periods, currentCFS, hasNWSForecast, gfHistoryPoints);

    // Store forecast predictions
    storeForecastPredictions(periods).catch(e => console.warn('Forecast storage error:', e));

    // Add click handlers
    document.querySelectorAll('.forecast-period').forEach(card => {
        card.onclick = function() {
            document.querySelectorAll('.forecast-period').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            const hrs = parseInt(card.dataset.hrs);
            showGraphMarker(hrs);
        };
    });
}

// ==================== FORECAST HELPERS ====================

export function formatForecastTime(date) {
    const hours = date.getHours();
    const ampm = hours >= 12 ? 'pm' : 'am';
    const hour12 = hours % 12 || 12;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${days[date.getDay()]} ${hour12}${ampm}`;
}

export function showGraphMarker(hrs) {
    const marker = document.getElementById('gf-graph-marker');
    const markerLine = document.getElementById('gf-marker-line');
    const markerDot = document.getElementById('gf-marker-dot');
    const tooltip = document.getElementById('gf-graph-tooltip');

    // Get graph state from forecast-graph module
    const fgData = getForecastGraphData();
    const gScales = getGraphScales();

    if (!marker || !gScales?.xScale || !fgData || fgData.length === 0) return;

    const dataPoint = fgData.find(d => d.hrs === hrs) ||
                      fgData.reduce((prev, curr) =>
                          Math.abs(curr.hrs - hrs) < Math.abs(prev.hrs - hrs) ? curr : prev
                      );

    const x = gScales.xScale(dataPoint.hrs);
    const y = gScales.yScale(dataPoint.stage);

    markerLine.setAttribute('x1', x);
    markerLine.setAttribute('x2', x);
    markerDot.setAttribute('cx', x);
    markerDot.setAttribute('cy', y);
    marker.style.display = 'block';

    document.getElementById('gf-tooltip-time').textContent = formatForecastTime(dataPoint.time);
    document.getElementById('gf-tooltip-stage').textContent = dataPoint.stage.toFixed(2);
    document.getElementById('gf-tooltip-cfs').textContent = dataPoint.cfs.toLocaleString();

    const graphContainer = document.getElementById('gf-graph-container');
    const tooltipX = Math.min(graphContainer.clientWidth - 110, Math.max(10, x - 40));
    const tooltipY = Math.max(5, y - 55);
    tooltip.style.left = tooltipX + 'px';
    tooltip.style.top = tooltipY + 'px';
    tooltip.style.display = 'block';
}

// ==================== FORECAST ACCURACY UI ====================

export function updateForecastAccuracyUI() {
    const container = document.getElementById('forecast-accuracy');
    if (!container || !forecastAccuracyData?.horizons) {
        if (container) container.style.display = 'none';
        return;
    }

    const totalValidations = Object.values(forecastAccuracyData.horizons)
        .reduce((sum, h) => sum + (h.validations || 0), 0);

    if (totalValidations < 10) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';

    const horizonStats = FORECAST_HORIZONS.map(h => {
        const stats = forecastAccuracyData.horizons[h] || { validations: 0, avgErrorPercent: null };
        if (stats.validations < 3 || stats.avgErrorPercent === null) {
            return `<span style="color:var(--text-muted);">+${h}h: --</span>`;
        }
        const accuracy = 100 - stats.avgErrorPercent;
        const color = accuracy >= 90 ? 'var(--accent-green)' : (accuracy >= 80 ? 'var(--accent-amber)' : 'var(--accent-red-light)');
        return `<span style="color:${color};">+${h}h: ${accuracy.toFixed(0)}%</span>`;
    }).join(' • ');

    let html = `<span style="color:var(--text-muted);">Forecast accuracy:</span> ${horizonStats} <span style="color:var(--text-faint);">(${totalValidations} validations)</span>`;

    const totalNwsValidations = Object.values(forecastAccuracyData.horizons)
        .reduce((sum, h) => sum + (h.nwsRawValidations || 0), 0);

    if (totalNwsValidations >= 10) {
        const nwsDeltaStats = FORECAST_HORIZONS.map(h => {
            const stats = forecastAccuracyData.horizons[h] || {};
            const ourAccuracy = stats.validations >= 3 && stats.avgErrorPercent !== null
                ? 100 - stats.avgErrorPercent : null;
            const nwsAccuracy = stats.nwsRawValidations >= 3 && stats.nwsRawAvgErrorPercent !== null
                ? 100 - stats.nwsRawAvgErrorPercent : null;

            if (ourAccuracy === null || nwsAccuracy === null) {
                return `<span style="color:var(--text-muted);">+${h}h: --</span>`;
            }
            const delta = ourAccuracy - nwsAccuracy;
            const sign = delta >= 0 ? '+' : '';
            const color = delta > 0 ? 'var(--accent-green)' : (delta < -1 ? 'var(--accent-red-light)' : 'var(--accent-amber)');
            const title = `Our model: ${ourAccuracy.toFixed(0)}% vs NWS: ${nwsAccuracy.toFixed(0)}%`;
            return `<span style="color:${color};" title="${title}">+${h}h: ${sign}${delta.toFixed(0)}%</span>`;
        }).join(' • ');

        html += `<br><span style="color:var(--text-muted);" title="Our model predicts Great Falls; NWS predicts Little Falls directly">vs NWS LF forecast:</span> ${nwsDeltaStats}`;
    }

    container.innerHTML = html;
}
